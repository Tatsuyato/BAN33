import { google } from "googleapis";
import { writeFile, readFile } from "fs/promises";
import { join } from "path";
import Fastify from "fastify";
import cron from "node-cron";
import { fileURLToPath } from "url";
import fastifyMultipart from "@fastify/multipart";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

const DB_PATH = join(__dirname, "db.json");
const SETTINGS_PATH = join(__dirname, "settings.json");
const TOKEN_PATH = join(__dirname, "token.json");
const SPAM_KEYWORDS = [/\bMAX ?33\b/i];

interface Comment {
    id: string;
    user: string;
    text: string;
    timestamp: number;
    category?: string;
}

interface SpamStats {
    [date: string]: {
        [hour: string]: number;
    };
}

interface Settings {
    apiKey?: string;
    schedule?: string;
    channelId?: string;
    clientId?: string;
    clientSecret?: string;
}

const fastify = Fastify({ logger: true });
fastify.register(fastifyMultipart, {
    limits: { fileSize: 1024 * 1024 }, // 1MB limit
});

async function loadDB(): Promise<{ comments: Comment[]; stats: SpamStats }> {
    try {
        const data = await readFile(DB_PATH, "utf-8");
        return JSON.parse(data);
    } catch (error) {
        return { comments: [], stats: {} };
    }
}

async function saveDB(db: { comments: Comment[]; stats: SpamStats }) {
    await writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

async function loadSettings(): Promise<Settings> {
    try {
        const data = await readFile(SETTINGS_PATH, "utf-8");
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

async function saveSettings(settings: Settings) {
    await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

async function getOAuthClient(settings: Settings) {
    const { clientId, clientSecret } = settings;
    if (!clientId || !clientSecret) {
        throw new Error("Client ID or Client Secret not set in settings.");
    }

    const oAuth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        "http://localhost:3000/oauth2callback"
    );

    try {
        const tokenData = await readFile(TOKEN_PATH, "utf-8");
        const tokens = JSON.parse(tokenData);
        oAuth2Client.setCredentials(tokens);

        if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
            const { credentials } = await oAuth2Client.refreshAccessToken();
            oAuth2Client.setCredentials(credentials);
            await writeFile(TOKEN_PATH, JSON.stringify(credentials, null, 2));
            fastify.log.info("Token refreshed and saved.");
        }

        return oAuth2Client;
    } catch (error) {
        fastify.log.error("Error loading token:", error);
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: "offline",
            scope: ["https://www.googleapis.com/auth/youtube.force-ssl"],
        });
        throw new Error(`Please authorize this app by visiting: ${authUrl}`);
    }
}

async function fetchYouTubeVideosByChannel(channelId: string, apiKey: string) {
    if (!apiKey) throw new Error("API Key is missing!");

    const youtube = google.youtube({ version: "v3", auth: apiKey });

    try {
        const response = await youtube.search.list({
            part: ["snippet"],
            channelId,
            maxResults: 5,
            order: "date",
        });

        return (
            response.data.items?.map((item: any) => ({
                id: item.id.videoId,
                title: item.snippet.title,
            })) || []
        );
    } catch (error) {
        fastify.log.error("Error fetching YouTube videos:", error);
        return [];
    }
}

async function fetchYouTubeComments(videoId: string, apiKey: string) {
    if (!apiKey) throw new Error("API Key is missing!");
    if (!videoId) return [];

    const youtube = google.youtube({ version: "v3", auth: apiKey });

    try {
        const response = await youtube.commentThreads.list({
            part: ["snippet"],
            videoId,
            maxResults: 10,
        });

        return (
            response.data.items?.map((item: any) => ({
                id: item.id,
                user: item.snippet.topLevelComment.snippet.authorDisplayName,
                text: item.snippet.topLevelComment.snippet.textDisplay,
                timestamp: new Date(item.snippet.topLevelComment.snippet.publishedAt).getTime(),
            })) || []
        );
    } catch (error) {
        fastify.log.error("Error fetching comments:", error);
        return [];
    }
}

async function markAndCategorizeComment(commentId: string, settings: Settings, db: { comments: Comment[]; stats: SpamStats }) {
    try {
        const authClient = await getOAuthClient(settings);
        const youtube = google.youtube({ version: "v3", auth: authClient });

        const commentResponse = await youtube.comments.list({
            part: ["snippet"],
            id: [commentId],
            textFormat: "plainText",
        });

        const commentItem = commentResponse.data.items?.[0];
        if (!commentItem?.snippet) {
            fastify.log.warn(`Comment with ID ${commentId} not found.`);
            return false;
        }

        const comment = commentItem.snippet;
        const commentData: Comment = {
            id: commentId,
            user: comment.authorDisplayName ?? "Unknown User",
            text: comment.textDisplay ?? "No text",
            timestamp: comment.publishedAt ? new Date(comment.publishedAt).getTime() : Date.now(),
        };

        if (!db.comments.find((c) => c.id === commentId)) {
            db.comments.push(commentData);
        }

        const isSpam = SPAM_KEYWORDS.some((regex) => regex.test(commentData.text));
        if (isSpam) {
            await youtube.comments.setModerationStatus({
                id: [commentId],
                moderationStatus: "heldForReview",
            });
            commentData.category = "สแปม";

            const date = new Date(commentData.timestamp);
            const day = date.toISOString().split("T")[0] as string;
            const hour = date.getHours().toString();

            db.stats[day] = db.stats[day] || {};
            db.stats[day][hour] = (db.stats[day][hour] || 0) + 1;

            fastify.log.info(`Marked comment ${commentId} as spam: ${commentData.text}`);
            return true;
        }

        fastify.log.info(`Comment ${commentId} is not spam.`);
        return false;
    } catch (error) {
        fastify.log.error(`Error processing comment ${commentId}:`, error);
        return false;
    }
}

async function autoFetchComments() {
    fastify.log.info("Starting auto-fetch of comments...");
    const settings = await loadSettings();
    const { apiKey, channelId } = settings;

    if (!apiKey || !channelId) {
        fastify.log.warn("API Key or Channel ID not set.");
        return;
    }

    try {
        const videos = await fetchYouTubeVideosByChannel(channelId, apiKey);
        const db = await loadDB();

        for (const video of videos) {
            const comments = await fetchYouTubeComments(video.id, apiKey);
            for (const comment of comments) {
                await markAndCategorizeComment(comment.id, settings, db);
            }
        }

        await saveDB(db);
        fastify.log.info("Comment fetch and processing completed.");
    } catch (error) {
        fastify.log.error("Error in autoFetchComments:", error);
    }
}

fastify.get("/oauth2callback", async (request, reply) => {
    const { code, error } = request.query as { code?: string; error?: string };
    const settings = await loadSettings();

    if (error) {
        fastify.log.error("OAuth error:", error);
        return reply.status(400).send(`Authorization failed: ${error}`);
    }

    if (!code) {
        return reply.status(400).send("No authorization code provided.");
    }

    try {
        const oAuth2Client = new google.auth.OAuth2(
            settings.clientId,
            settings.clientSecret,
            "http://localhost:3000/oauth2callback"
        );
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        fastify.log.info("Token stored to", TOKEN_PATH);

        return reply.send(`
            <h1>Authentication Successful!</h1>
            <p>You can now close this window and return to the application.</p>
            <a href="/">Go to Dashboard</a>
        `);
    } catch (error) {
        fastify.log.error("Error saving token:", error);
        return reply.status(500).send(`Authentication failed: ${error}`);
    }
});

fastify.get("/", async (request, reply) => {
    const settings = await loadSettings();
    if (!settings.apiKey || !settings.channelId || !settings.clientId || !settings.clientSecret) {
        return reply.redirect("/setup");
    }

    const db = await loadDB();
    const commentMap = new Map<string, boolean>();
    const spamStatus = new Map<Comment, boolean>();

    db.comments.forEach((comment) => {
        const key = `${comment.id}|${comment.text}`;
        if (commentMap.has(key) || comment.category === "สแปม") {
            spamStatus.set(comment, true);
        } else {
            spamStatus.set(comment, false);
            commentMap.set(key, true);
        }
    });

    const totalComments = db.comments.length;
    const spamComments = db.comments.filter((c) => spamStatus.get(c)).length;
    const spamPercentage = totalComments > 0 ? ((spamComments / totalComments) * 100).toFixed(1) : 0;
    const spamUsers = new Set(db.comments.filter((c) => spamStatus.get(c)).map((c) => c.user)).size;

    const commentsHtml = db.comments
        .map(
            (comment) => `
        <div class="comment ${spamStatus.get(comment) ? "spam-comment" : ""}">
            <div class="comment-header">
                <div class="comment-user">${comment.user}</div>
                <div class="comment-status">${comment.category === "สแปม" ? "สแปม" : spamStatus.get(comment) ? "SPAM" : "Approved"}</div>
            </div>
            <div class="comment-text">${comment.text}</div>
            <div class="comment-timestamp">${new Date(comment.timestamp).toLocaleString()}</div>
            <div class="comment-id">ID: ${comment.id}</div>
        </div>
    `
        )
        .join("");

    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin Dashboard - Comment Management</title>
            <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700&display=swap">
            <style>
                body { font-family: 'Roboto', sans-serif; margin: 0; padding: 20px; background: #f5f6fa; }
                .dashboard-container { max-width: 1200px; margin: 0 auto; }
                .header { background: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px; }
                .stat-card { background: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .stat-card h3 { margin: 0 0 10px 0; color: #666; font-size: 16px; }
                .stat-card .value { font-size: 24px; font-weight: bold; color: #2c3e50; }
                .comment { background: #ffffff; border: 1px solid #eee; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
                .spam-comment { background: #fff5f5; border-color: #ffcccc; }
                .comment-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
                .comment-user { font-weight: 500; color: #2c3e50; }
                .comment-status { padding: 4px 8px; border-radius: 12px; font-size: 12px; background: #e0f7fa; color: #00695c; }
                .spam-comment .comment-status { background: #ffebee; color: #c62828; }
                .comment-text { color: #555; margin-bottom: 8px; }
                .comment-timestamp { color: #888; font-size: 0.9em; margin-bottom: 4px; }
                .comment-id { color: #999; font-size: 0.8em; font-style: italic; }
            </style>
        </head>
        <body>
            <div class="dashboard-container">
                <div class="header">
                    <h1>Comment Management Dashboard</h1>
                </div>
                <div class="stats-grid">
                    <div class="stat-card">
                        <h3>Total Comments</h3>
                        <div class="value">${totalComments}</div>
                    </div>
                    <div class="stat-card">
                        <h3>Spam Comments</h3>
                        <div class="value">${spamComments}</div>
                    </div>
                    <div class="stat-card">
                        <h3>Spam Percentage</h3>
                        <div class="value">${spamPercentage}%</div>
                    </div>
                    <div class="stat-card">
                        <h3>Spam Users</h3>
                        <div class="value">${spamUsers}</div>
                    </div>
                </div>
                <div id="comments-container">${commentsHtml}</div>
            </div>
        </body>
        </html>
    `;
    return reply.type("text/html").send(html);
});

fastify.get("/setup", async (_, reply) => {
    const settings = await loadSettings();
    let authButton = "";
    if (settings.clientId && settings.clientSecret) {
        const oAuth2Client = new google.auth.OAuth2(
            settings.clientId,
            settings.clientSecret,
            "http://localhost:3000/oauth2callback"
        );
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: "offline",
            scope: ["https://www.googleapis.com/auth/youtube.force-ssl"],
        });
        authButton = `<a href="${authUrl}" class="auth-btn">Authorize with Google</a>`;
    }

    return reply.type("text/html").send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Setup - Comment Management</title>
            <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
            <style>
                body { font-family: 'Roboto', sans-serif; background: #f5f6fa; margin: 0; padding: 0; min-height: 100vh; }
                .setup-container { max-width: 600px; margin: 40px auto; background: #ffffff; padding: 32px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .form-group { margin-bottom: 20px; }
                .form-group label { display: block; color: #666; font-weight: 500; margin-bottom: 6px; }
                .form-group input, .form-group select { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; }
                .submit-btn { width: 100%; padding: 12px; background: #2ecc71; color: white; border: none; border-radius: 6px; cursor: pointer; }
                .submit-btn:hover { background: #27ae60; }
                .auth-btn { display: inline-block; width: 100%; padding: 12px; background: #4285f4; color: white; text-align: center; text-decoration: none; border-radius: 6px; margin-top: 20px; }
                .auth-btn:hover { background: #357abd; }
                .info-text { color: #555; font-size: 12px; margin-top: 8px; }
                .info-text a { color: #3498db; text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="setup-container">
                <h1 class="text-2xl font-bold mb-6">Setup Configuration</h1>
                <form method="POST" action="/setup">
                    <div class="form-group">
                        <label for="apiKey">API Key</label>
                        <input type="text" name="apiKey" id="apiKey" value="${settings.apiKey || ""}" required>
                        <div class="info-text">
                            Get this from <a href="https://console.developers.google.com/apis/credentials" target="_blank">Google Cloud Console</a>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="clientId">Client ID</label>
                        <input type="text" name="clientId" id="clientId" value="${settings.clientId || ""}" required>
                    </div>
                    <div class="form-group">
                        <label for="clientSecret">Client Secret</label>
                        <input type="text" name="clientSecret" id="clientSecret" value="${settings.clientSecret || ""}" required>
                    </div>
                    <div class="form-group">
                        <label for="scheduleMinute">Schedule Minute (0-59)</label>
                        <select name="scheduleMinute" id="scheduleMinute">
                            <option value="*">Every Minute (*)</option>
                            ${Array.from({ length: 60 }, (_, i) => `<option value="${i}" ${settings.schedule?.split(" ")[0] === i.toString() ? "selected" : ""}>${i}</option>`).join("")}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="scheduleHour">Schedule Hour (0-23)</label>
                        <select name="scheduleHour" id="scheduleHour">
                            <option value="*">Every Hour (*)</option>
                            ${Array.from({ length: 24 }, (_, i) => `<option value="${i}" ${settings.schedule?.split(" ")[1] === i.toString() ? "selected" : ""}>${i}</option>`).join("")}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="scheduleDay">Schedule Day</label>
                        <select name="scheduleDay" id="scheduleDay">
                            <option value="*">Every Day (*)</option>
                            <option value="0" ${settings.schedule?.split(" ")[4] === "0" ? "selected" : ""}>Sunday</option>
                            <option value="1" ${settings.schedule?.split(" ")[4] === "1" ? "selected" : ""}>Monday</option>
                            <option value="2" ${settings.schedule?.split(" ")[4] === "2" ? "selected" : ""}>Tuesday</option>
                            <option value="3" ${settings.schedule?.split(" ")[4] === "3" ? "selected" : ""}>Wednesday</option>
                            <option value="4" ${settings.schedule?.split(" ")[4] === "4" ? "selected" : ""}>Thursday</option>
                            <option value="5" ${settings.schedule?.split(" ")[4] === "5" ? "selected" : ""}>Friday</option>
                            <option value="6" ${settings.schedule?.split(" ")[4] === "6" ? "selected" : ""}>Saturday</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="channelId">Channel ID</label>
                        <input type="text" name="channelId" id="channelId" value="${settings.channelId || ""}" required>
                    </div>
                    <button type="submit" class="submit-btn">Save Settings</button>
                    ${authButton}
                </form>
            </div>
        </body>
        </html>
    `);
});

fastify.post("/setup", async (request, reply) => {
    const fields = request.body as any;

    const { apiKey, clientId, clientSecret, scheduleDay, scheduleHour, scheduleMinute, channelId } = fields;

    const settings: Settings = {
        apiKey,
        clientId,
        clientSecret,
        channelId,
        schedule: `${scheduleMinute || "*"} ${scheduleHour || "*"} * * ${scheduleDay || "*"}`,
    };

    await saveSettings(settings);

    const cronExpression = settings.schedule || "* * * * *";
    if (!cron.validate(cronExpression)) {
        fastify.log.error("Invalid cron expression:", cronExpression);
        return reply.status(400).send({ error: "Invalid cron expression" });
    }

    cron.schedule(cronExpression, autoFetchComments);
    fastify.log.info("Cron job scheduled with:", cronExpression);

    return reply.redirect("/setup"); // Redirect back to setup to show the auth button
});

async function startServer() {
    try {
        await fastify.listen({ port: 3000 });
        fastify.log.info("Server running at http://localhost:3000");

        const settings = await loadSettings();
        if (settings.schedule && cron.validate(settings.schedule)) {
            autoFetchComments();
            cron.schedule(settings.schedule, autoFetchComments);
            fastify.log.info("Cron job initialized with:", settings.schedule);
        }
    } catch (error) {
        fastify.log.error("Server failed to start:", error);
        process.exit(1);
    }
}

startServer();