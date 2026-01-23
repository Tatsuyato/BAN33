import { google } from "googleapis";
import { writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import Fastify from "fastify";
import cron from "node-cron";
import { fileURLToPath } from "url";
import fastifyMultipart from "@fastify/multipart";
import formbody from '@fastify/formbody';

// --- CONFIGURATION & CONSTANTS ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

const DIRS = {
    data: join(__dirname, "data"),
    config: join(__dirname, "config")
};

const FILES = {
    db: join(DIRS.data, "db.json"),
    settings: join(DIRS.config, "settings.json"),
    token: join(DIRS.config, "token.json")
};

// Regex for filtering spam
const SPAM_KEYWORDS = [
    /\bMAX ?33\b/i,
    /รับงาน/i,
    /โปรโมชั่น/i
];

// --- INTERFACES ---
interface Comment {
    id: string;
    videoId: string;
    videoTitle: string;
    user: string;
    text: string;
    timestamp: number;
    category?: string;
    isSpam: boolean;
}

interface SpamStats {
    [date: string]: {
        [hour: string]: number;
    };
}

interface DBSchema {
    comments: Comment[];
    stats: SpamStats;
    lastScan?: number;
}

interface Settings {
    apiKey?: string;
    schedule?: string;
    channelId?: string;
    clientId?: string;
    clientSecret?: string;
}

// --- UTILITIES (DB & FILE MANAGER) ---
class DataManager {
    static async init() {
        for (const dir of Object.values(DIRS)) {
            if (!existsSync(dir)) await mkdir(dir, { recursive: true });
        }
        if (!existsSync(FILES.db)) await this.saveDB({ comments: [], stats: {} });
        if (!existsSync(FILES.settings)) await this.saveSettings({});
    }

    static async loadDB(): Promise<DBSchema> {
        try {
            const data = await readFile(FILES.db, "utf-8");
            return JSON.parse(data);
        } catch {
            return { comments: [], stats: {} };
        }
    }

    static async saveDB(db: DBSchema) {
        await writeFile(FILES.db, JSON.stringify(db, null, 2));
    }

    static async loadSettings(): Promise<Settings> {
        try {
            const data = await readFile(FILES.settings, "utf-8");
            return JSON.parse(data);
        } catch {
            return {};
        }
    }

    static async saveSettings(settings: Settings) {
        await writeFile(FILES.settings, JSON.stringify(settings, null, 2));
    }

    static async loadToken() {
        try {
            return JSON.parse(await readFile(FILES.token, "utf-8"));
        } catch {
            return null;
        }
    }

    static async saveToken(token: any) {
        await writeFile(FILES.token, JSON.stringify(token, null, 2));
    }
}

// --- YOUTUBE SERVICE ---
class YouTubeService {
    static async getOAuthClient(settings: Settings) {
        if (!settings.clientId || !settings.clientSecret) {
            throw new Error("Client ID or Secret missing.");
        }

        const client = new google.auth.OAuth2(
            settings.clientId,
            settings.clientSecret,
            "http://localhost:3000/oauth2callback"
        );

        const tokens = await DataManager.loadToken();
        if (tokens) {
            client.setCredentials(tokens);
            if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
                try {
                    const { credentials } = await client.refreshAccessToken();
                    client.setCredentials(credentials);
                    await DataManager.saveToken(credentials);
                    console.log("🔄 Token refreshed automatically.");
                } catch (e) {
                    console.error("Failed to refresh token", e);
                }
            }
        }
        return client;
    }

    static async fetchVideos(channelId: string, apiKey: string) {
        const youtube = google.youtube({ version: "v3", auth: apiKey });
        
        // FIX: 'part' and 'type' should be string arrays to match TypeScript overload
        const res = await youtube.search.list({
            part: ["snippet"], 
            channelId,
            maxResults: 10,
            order: "date",
            type: ["video"] 
        });

        return res.data.items?.map(item => ({
            id: item.id?.videoId!,
            title: item.snippet?.title || "Unknown Title"
        })) || [];
    }

    static async processComments(settings: Settings) {
        if (!settings.apiKey || !settings.channelId) throw new Error("Missing Config");
        
        console.log("🚀 Starting comment scan...");
        const db = await DataManager.loadDB();
        const authClient = await this.getOAuthClient(settings);
        const youtubeAuth = google.youtube({ version: "v3", auth: authClient });
        const youtubePublic = google.youtube({ version: "v3", auth: settings.apiKey });

        const videos = await this.fetchVideos(settings.channelId, settings.apiKey);
        
        let newSpamCount = 0;

        for (const video of videos) {
            try {
                const res = await youtubePublic.commentThreads.list({
                    part: ["snippet"],
                    videoId: video.id,
                    maxResults: 20,
                    textFormat: "plainText"
                });

                const items = res.data.items || [];

                for (const item of items) {
                    const topComment = item.snippet?.topLevelComment?.snippet;
                    if (!topComment) continue;

                    const commentId = item.id!;
                    const text = topComment.textDisplay || "";
                    
                    if (db.comments.some(c => c.id === commentId)) continue;

                    const isSpam = SPAM_KEYWORDS.some(regex => regex.test(text));

                    const commentData: Comment = {
                        id: commentId,
                        videoId: video.id,
                        videoTitle: video.title,
                        user: topComment.authorDisplayName || "Unknown",
                        text: text,
                        timestamp: new Date(topComment.publishedAt!).getTime(),
                        category: isSpam ? "SPAM" : "General",
                        isSpam
                    };

                    db.comments.push(commentData);

                    if (isSpam) {
                        newSpamCount++;
                        try {
                            await youtubeAuth.comments.setModerationStatus({
                                id: [commentId],
                                moderationStatus: "heldForReview"
                            });
                            console.log(`🚫 Marked SPAM: ${text} (User: ${commentData.user})`);
                            
                            // FIX: Ensure date is strictly a string for indexing
                            const date = new Date().toISOString().split("T")[0] as string;
                            const hour = new Date().getHours().toString();
                            
                            db.stats[date] = db.stats[date] || {};
                            db.stats[date][hour] = (db.stats[date][hour] || 0) + 1;

                        } catch (err) {
                            console.error(`Failed to moderate comment ${commentId}:`, err);
                        }
                    }
                }
            } catch (err) {
                console.error(`Error processing video ${video.id}:`, err);
            }
        }

        db.lastScan = Date.now();
        await DataManager.saveDB(db);
        console.log(`✅ Scan complete. Found ${newSpamCount} new spam comments.`);
        return { processed: videos.length, newSpam: newSpamCount };
    }
}

// --- SERVER SETUP ---
const fastify = Fastify({ logger: true });
fastify.register(fastifyMultipart);
fastify.register(formbody);

// --- ROUTES ---

fastify.get("/", async (req, reply) => {
    const settings = await DataManager.loadSettings();
    if (!settings.apiKey || !settings.channelId) return reply.redirect("/setup");

    const db = await DataManager.loadDB();
    const totalComments = db.comments.length;
    const spamComments = db.comments.filter(c => c.isSpam).length;
    const spamPercentage = totalComments > 0 ? ((spamComments / totalComments) * 100).toFixed(1) : "0";
    
    const commentsHtml = db.comments
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 50)
        .map(c => `
            <tr class="hover:bg-gray-50 ${c.isSpam ? 'bg-red-50' : ''}">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${c.user}</td>
                <td class="px-6 py-4 text-sm text-gray-500 max-w-md truncate" title="${c.text}">${c.text}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${c.videoTitle.substring(0, 20)}...</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${c.isSpam ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}">
                        ${c.isSpam ? 'SPAM' : 'Approved'}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(c.timestamp).toLocaleString()}</td>
            </tr>
        `).join("");

    const lastScanTime = db.lastScan ? new Date(db.lastScan).toLocaleString() : "Never";

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>YouGuard Dashboard</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    </head>
    <body class="bg-gray-100 font-sans" style="font-family: 'Inter', sans-serif;">
        <div class="min-h-screen">
            <nav class="bg-white shadow-sm">
                <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div class="flex justify-between h-16">
                        <div class="flex items-center">
                            <h1 class="text-xl font-bold text-indigo-600">YouGuard <span class="text-gray-500 text-sm font-normal">Manager</span></h1>
                        </div>
                        <div class="flex items-center space-x-4">
                            <span class="text-sm text-gray-500">Last Scan: ${lastScanTime}</span>
                            <a href="/setup" class="text-gray-600 hover:text-indigo-600">Settings</a>
                        </div>
                    </div>
                </div>
            </nav>

            <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                <div class="grid grid-cols-1 gap-5 sm:grid-cols-3 mb-8">
                    <div class="bg-white overflow-hidden shadow rounded-lg">
                        <div class="px-4 py-5 sm:p-6">
                            <dt class="text-sm font-medium text-gray-500 truncate">Total Scanned</dt>
                            <dd class="mt-1 text-3xl font-semibold text-gray-900">${totalComments}</dd>
                        </div>
                    </div>
                    <div class="bg-white overflow-hidden shadow rounded-lg">
                        <div class="px-4 py-5 sm:p-6">
                            <dt class="text-sm font-medium text-gray-500 truncate">Spam Detected</dt>
                            <dd class="mt-1 text-3xl font-semibold text-red-600">${spamComments}</dd>
                        </div>
                    </div>
                    <div class="bg-white overflow-hidden shadow rounded-lg">
                        <div class="px-4 py-5 sm:p-6">
                            <dt class="text-sm font-medium text-gray-500 truncate">Spam Rate</dt>
                            <dd class="mt-1 text-3xl font-semibold text-indigo-600">${spamPercentage}%</dd>
                        </div>
                    </div>
                </div>

                <div class="mb-6 flex justify-end">
                    <form action="/trigger-scan" method="POST">
                        <button type="submit" class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                            Run Manual Scan Now
                        </button>
                    </form>
                </div>

                <div class="bg-white shadow overflow-hidden sm:rounded-lg">
                    <div class="px-4 py-5 sm:px-6 border-b border-gray-200">
                        <h3 class="text-lg leading-6 font-medium text-gray-900">Recent Comments</h3>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="min-w-full divide-y divide-gray-200">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Comment</th>
                                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Video</th>
                                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                                </tr>
                            </thead>
                            <tbody class="bg-white divide-y divide-gray-200">
                                ${commentsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>
        </div>
    </body>
    </html>
    `;
    return reply.type("text/html").send(html);
});

fastify.get("/setup", async (req, reply) => {
    const settings = await DataManager.loadSettings();
    
    let authUrl = "#";
    let authStatus = `<span class="text-red-500">Not Connected</span>`;
    
    if (settings.clientId && settings.clientSecret) {
        try {
            const client = new google.auth.OAuth2(settings.clientId, settings.clientSecret, "http://localhost:3000/oauth2callback");
            authUrl = client.generateAuthUrl({ access_type: "offline", scope: ["https://www.googleapis.com/auth/youtube.force-ssl"] });
            const token = await DataManager.loadToken();
            if (token) authStatus = `<span class="text-green-500 font-bold">Connected ✅</span>`;
        } catch (e) { console.log(e); }
    }

    // FIX: Converted comparisons to match string types (.toString())
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Configuration</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-100 py-10">
        <div class="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow-md">
            <div class="flex items-center justify-between mb-6">
                <h1 class="text-2xl font-bold text-gray-800">System Configuration</h1>
                <a href="/" class="text-indigo-600 hover:text-indigo-800">&larr; Back to Dashboard</a>
            </div>
            
            <form action="/setup" method="POST" class="space-y-6">
                <div>
                    <label class="block text-sm font-medium text-gray-700">API Key</label>
                    <input type="text" name="apiKey" value="${settings.apiKey || ""}" required class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500">
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Client ID</label>
                        <input type="text" name="clientId" value="${settings.clientId || ""}" required class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Client Secret</label>
                        <input type="password" name="clientSecret" value="${settings.clientSecret || ""}" required class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                </div>

                <div>
                    <label class="block text-sm font-medium text-gray-700">Channel ID</label>
                    <input type="text" name="channelId" value="${settings.channelId || ""}" required class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-indigo-500 focus:border-indigo-500">
                </div>

                <div class="bg-gray-50 p-4 rounded-md">
                    <label class="block text-sm font-medium text-gray-700 mb-2">Cron Schedule</label>
                    <div class="grid grid-cols-3 gap-4">
                        <select name="scheduleMinute" class="border p-2 rounded">${Array.from({length:60}, (_,i) => `<option value="${i}" ${settings.schedule?.split(' ')[0] == i.toString() ? 'selected':''}>Minute: ${i}</option>`).join('')}<option value="*" ${settings.schedule?.startsWith('*')?'selected':''}>Every Minute</option></select>
                        <select name="scheduleHour" class="border p-2 rounded"><option value="*">Every Hour</option>${Array.from({length:24}, (_,i) => `<option value="${i}" ${settings.schedule?.split(' ')[1] == i.toString() ? 'selected':''}>Hour: ${i}</option>`).join('')}</select>
                        <select name="scheduleDay" class="border p-2 rounded"><option value="*">Every Day</option><option value="1">Monday</option><option value="5">Friday</option></select>
                    </div>
                </div>

                <button type="submit" class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none">
                    Save Configuration
                </button>
            </form>

            <div class="mt-8 pt-6 border-t border-gray-200">
                <h3 class="text-lg font-medium text-gray-900">Google Authorization</h3>
                <div class="mt-2 flex items-center justify-between">
                    <p class="text-sm text-gray-500">Status: ${authStatus}</p>
                    ${settings.clientId ? `<a href="${authUrl}" class="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">Authorize with Google</a>` : ''}
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
    return reply.type("text/html").send(html);
});

fastify.post("/setup", async (req, reply) => {
    const body: any = req.body;
    const schedule = `${body.scheduleMinute || "*"} ${body.scheduleHour || "*"} * * ${body.scheduleDay || "*"}`;
    
    await DataManager.saveSettings({
        apiKey: body.apiKey,
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        channelId: body.channelId,
        schedule
    });

    initCron();

    return reply.redirect("/setup");
});

fastify.get("/oauth2callback", async (req, reply) => {
    const { code } = req.query as any;
    if (!code) return reply.send("Error: No code provided");

    try {
        const settings = await DataManager.loadSettings();
        const client = new google.auth.OAuth2(settings.clientId, settings.clientSecret, "http://localhost:3000/oauth2callback");
        const { tokens } = await client.getToken(code);
        await DataManager.saveToken(tokens);
        return reply.redirect("/setup");
    } catch (err) {
        return reply.send(`Authentication Failed: ${err}`);
    }
});

fastify.post("/trigger-scan", async (req, reply) => {
    const settings = await DataManager.loadSettings();
    try {
        await YouTubeService.processComments(settings);
        return reply.redirect("/");
    } catch (err) {
        return reply.send(`Scan Failed: ${err}`);
    }
});

// --- CRON JOB MANAGEMENT ---
// FIX: Using ReturnType to get the correct type from the library
let cronTask: ReturnType<typeof cron.schedule> | null = null;

async function initCron() {
    const settings = await DataManager.loadSettings();
    
    if (cronTask) {
        cronTask.stop();
        cronTask = null;
    }

    if (settings.schedule && cron.validate(settings.schedule)) {
        console.log(`⏰ Cron scheduled: ${settings.schedule}`);
        cronTask = cron.schedule(settings.schedule, async () => {
            try {
                await YouTubeService.processComments(settings);
            } catch (e) {
                console.error("Cron Execution Failed:", e);
            }
        });
    }
}

// --- BOOTSTRAP ---
async function start() {
    try {
        await DataManager.init();
        await initCron();
        await fastify.listen({ port: 3000 });
        console.log("🚀 Server running at http://localhost:3000");
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}

start();
