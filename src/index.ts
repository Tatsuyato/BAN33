import { google } from "googleapis";
import { writeFile, readFile } from "fs/promises";
import { join } from "path";
import Fastify from "fastify";
import cron from "node-cron";

const DB_PATH = join(import.meta.dir, "db.json");
const SETTINGS_PATH = join(import.meta.dir, "settings.json");
const SPAM_KEYWORDS = [/\bMAX ?33\b/i];

interface Comment {
    id: string;
    user: string;
    text: string;
    timestamp: number;
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
}

const fastify = Fastify();

// Register the fastify-formbody plugin
fastify.register(require('@fastify/formbody'))

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

// Function to fetch the latest videos from a YouTube channel using googleapis
async function fetchYouTubeVideosByChannel(channelId: string) {
    const settings = await loadSettings();
    if (!settings.apiKey) return [];

    const youtube = google.youtube({ version: "v3", auth: settings.apiKey });
    
    try {
        const response = await youtube.search.list({
            part: ["snippet"],
            channelId: channelId,
            maxResults: 5,
            order: "date"
        });

        if (!response.data.items) {
            console.error("No videos found for the channel");
            return [];
        }

        return response.data.items.map((item: any) => ({
            id: item.id.videoId,
            title: item.snippet.title,
        }));
    } catch (error) {
        console.error("Error fetching YouTube videos:", error);
        return [];
    }
}

// Function to fetch YouTube comments using googleapis
async function fetchYouTubeComments(videoId: string) {
    const settings = await loadSettings();
    if (!settings.apiKey) throw new Error("API Key is missing!");
    if (!videoId) return [];

    const youtube = google.youtube({ version: "v3", auth: settings.apiKey });

    try {
        console.log(`Fetching comments for video: ${videoId}`);
        const response = youtube.commentThreads.list({
            part: ["snippet"],
            videoId: videoId,
            maxResults: 10
        });

        return (await response).data.items?.map((item: any) => ({
            id: item.id,
            user: item.snippet.topLevelComment.snippet.authorDisplayName,
            text: item.snippet.topLevelComment.snippet.textDisplay,
            timestamp: new Date(item.snippet.topLevelComment.snippet.publishedAt).getTime(),
        })) || [];
    } catch (error) {
        console.error("Error fetching comments:", error);
        return [];
    }
}

// Function to fetch comments from the latest videos
async function autoFetchComments() {
    console.log("Fetching comments...");
    const settings = await loadSettings();
    if (!settings.channelId || !settings.apiKey) {
        console.log("API Key or Channel ID not set.");
        return;
    }

    try {
        const videos = await fetchYouTubeVideosByChannel(settings.channelId);
        const db = await loadDB();

        for (const video of videos) {
            const comments = await fetchYouTubeComments(video.id);

            // Filter out comments that already exist in the database
            const existingCommentIds = new Set(db.comments.map(comment => comment.id));
            const newComments = comments.filter(comment => !existingCommentIds.has(comment.id));

            db.comments.push(...newComments);

            for (const comment of newComments) {
            if (SPAM_KEYWORDS.some((regex) => regex.test(comment.text))) {
                // Mark the comment as spam using Google API
                try {
                const youtube = google.youtube({ version: "v3", auth: settings.apiKey });
                await youtube.comments.setModerationStatus({
                    id: comment.id,
                    moderationStatus: "rejected"
                });
                console.log(`Marked comment as spam: ${comment.text}`);

                // Update spam stats
                const date = new Date(comment.timestamp);
                const day = date.toISOString().split("T")[0] as string;
                const hour = date.getHours().toString();

                if (!db.stats[day]) {
                    db.stats[day] = {};
                }
                if (!db.stats[day][hour]) {
                    db.stats[day][hour] = 0;
                }
                db.stats[day][hour]++;
                } catch (error) {
                console.error(`Failed to mark comment as spam: ${comment.text}`, error);
                }
            }
            }
        }

        await saveDB(db);
    } catch (error) {
        console.error("Error fetching comments:", error);
    }
}

fastify.get("/", async (request, reply) => {
    const settings = await loadSettings();
    if (!settings.apiKey || !settings.channelId) {
        return reply.redirect("/setup");
    }
    const db = await loadDB();
    
    // Detect duplicates and track spam status
    const commentMap = new Map();
    const spamStatus = new Map();
    
    db.comments.forEach(comment => {
        const key = `${comment.id}|${comment.text}`;
        if (commentMap.has(key)) {
            spamStatus.set(comment, true);
        } else {
            spamStatus.set(comment, false);
            commentMap.set(key, true);
        }
    });

    // Calculate spam statistics
    const totalComments = db.comments.length;
    const spamComments = db.comments.filter(comment => spamStatus.get(comment)).length;
    const spamPercentage = totalComments > 0 ? ((spamComments / totalComments) * 100).toFixed(1) : 0;
    const spamUsers = [...new Set(db.comments
        .filter(comment => spamStatus.get(comment))
        .map(comment => comment.user))].length;

    // Generate comments HTML
    const commentsHtml = db.comments.map(comment => `
        <div class="comment ${spamStatus.get(comment) ? 'spam-comment' : ''}">
            <div class="comment-header">
                <div class="comment-user">${comment.user}</div>
                <div class="comment-status">${spamStatus.get(comment) ? 'SPAM' : 'Approved'}</div>
            </div>
            <div class="comment-text">${comment.text}</div>
            <div class="comment-timestamp">${new Date(comment.timestamp).toLocaleString()}</div>
            <div class="comment-id">ID: ${comment.id}</div>
        </div>
    `).join('');

    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin Dashboard - Comment Management</title>
            <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700&display=swap">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/mui/5.0.0-alpha.36/material-ui.min.css">
            <style>
                body {
                    font-family: 'Roboto', sans-serif;
                    margin: 0;
                    padding: 20px;
                    background: #f5f6fa;
                }
                .dashboard-container {
                    max-width: 1200px;
                    margin: 0 auto;
                }
                .header {
                    background: #ffffff;
                    padding: 20px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    margin-bottom: 20px;
                }
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin-bottom: 20px;
                }
                .stat-card {
                    background: #ffffff;
                    padding: 20px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .stat-card h3 {
                    margin: 0 0 10px 0;
                    color: #666;
                    font-size: 16px;
                }
                .stat-card .value {
                    font-size: 24px;
                    font-weight: bold;
                    color: #2c3e50;
                }
                .comment {
                    background: #ffffff;
                    border: 1px solid #eee;
                    border-radius: 8px;
                    padding: 16px;
                    margin-bottom: 16px;
                    transition: all 0.2s;
                }
                .comment:hover {
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .spam-comment {
                    background: #fff5f5;
                    border-color: #ffcccc;
                }
                .comment-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }
                .comment-user {
                    font-weight: 500;
                    color: #2c3e50;
                }
                .comment-status {
                    padding: 4px 8px;
                    border-radius: 12px;
                    font-size: 12px;
                    background: #e0f7fa;
                    color: #00695c;
                }
                .spam-comment .comment-status {
                    background: #ffebee;
                    color: #c62828;
                }
                .comment-text {
                    color: #555;
                    margin-bottom: 8px;
                }
                .comment-timestamp {
                    color: #888;
                    font-size: 0.9em;
                    margin-bottom: 4px;
                }
                .comment-id {
                    color: #999;
                    font-size: 0.8em;
                    font-style: italic;
                }
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

                <div id="comments-container">
                    ${commentsHtml}
                </div>
            </div>
        </body>
        </html>
    `;

    return reply.type('text/html').send(html);
});

fastify.get("/setup", async (_, reply) => {
    return reply.type("text/html").send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Setup - Comment Management</title>
            <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
            <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto:300,400,500,700&display=swap">
            <style>
                body {
                    font-family: 'Roboto', sans-serif;
                    background: #f5f6fa;
                    margin: 0;
                    padding: 0;
                    min-height: 100vh;
                }
                .setup-container {
                    max-width: 600px;
                    margin: 40px auto;
                    background: #ffffff;
                    padding: 32px;
                    border-radius: 8px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .header {
                    margin-bottom: 24px;
                }
                .header h1 {
                    color: #2c3e50;
                    font-size: 28px;
                    font-weight: 500;
                }
                .api-link {
                    display: inline-block;
                    margin-bottom: 24px;
                    padding: 10px 20px;
                    background: #3498db;
                    color: white;
                    text-decoration: none;
                    border-radius: 6px;
                    transition: background 0.2s;
                }
                .api-link:hover {
                    background: #2980b9;
                }
                .form-group {
                    margin-bottom: 20px;
                }
                .form-group label {
                    display: block;
                    color: #666;
                    font-size: 14px;
                    font-weight: 500;
                    margin-bottom: 6px;
                }
                .form-group input,
                .form-group select {
                    width: 100%;
                    padding: 10px 14px;
                    border: 1px solid #ddd;
                    border-radius: 6px;
                    font-size: 14px;
                    color: #333;
                    transition: border-color 0.2s;
                }
                .form-group input:focus,
                .form-group select:focus {
                    outline: none;
                    border-color: #3498db;
                    box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
                }
                .submit-btn {
                    width: 100%;
                    padding: 12px;
                    background: #2ecc71;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 16px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .submit-btn:hover {
                    background: #27ae60;
                }
            </style>
        </head>
        <body>
            <div class="setup-container">
                <div class="header">
                    <h1>Setup Configuration</h1>
                </div>

                <a href="https://console.developers.google.com/apis/credentials" target="_blank" class="api-link">
                    Get API Key from Google Console
                </a>

                <form method="POST" action="/setup">
                    <div class="form-group">
                        <label for="apiKey">API Key</label>
                        <input type="text" name="apiKey" id="apiKey" required placeholder="Enter your Google API Key">
                    </div>

                    <div class="form-group">
                        <label for="scheduleDay">Schedule Day (0-6)</label>
                        <select name="scheduleDay" id="scheduleDay">
                            <option value="0">Every Day (*)</option>
                            <option value="1">Sunday (0)</option>
                            <option value="2">Monday (1)</option>
                            <option value="3">Tuesday (2)</option>
                            <option value="4">Wednesday (3)</option>
                            <option value="5">Thursday (4)</option>
                            <option value="6">Friday (5)</option>
                            <option value="7">Saturday (6)</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="scheduleHour">Schedule Hour (0-23)</label>
                        <select name="scheduleHour" id="scheduleHour">
                            <option value="0">Every Hour (*)</option>
                            ${Array.from({ length: 24 }, (_, i) => `
                                <option value="${i + 1}">${i.toString().padStart(2, '0')}</option>
                            `).join('')}
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="scheduleMinute">Schedule Minute (0-59)</label>
                        <select name="scheduleMinute" id="scheduleMinute">
                            <option value="0">Every Minute (*)</option>
                            ${Array.from({ length: 60 }, (_, i) => `
                                <option value="${i + 1}">${i.toString().padStart(2, '0')}</option>
                            `).join('')}
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="channelId">Channel ID</label>
                        <input type="text" name="channelId" id="channelId" required placeholder="Enter your Channel ID">
                    </div>

                    <button type="submit" class="submit-btn">Save Settings</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

fastify.post("/setup", async (request, reply) => {
    const { apiKey, scheduleDay, scheduleHour, scheduleMinute, channelId } = request.body as any;

    // Save settings
    const settings: Settings = {
        apiKey,
        channelId,
        schedule: `${scheduleMinute || '*'} ${scheduleHour || '*'} * * ${scheduleDay === '0' ? '*' : scheduleDay}`
    };

    await saveSettings(settings);

    // Validate the cron expression
    const cronExpression = settings.schedule as string
    if (!cron.validate(cronExpression)) {
        console.error("Invalid cron expression:", cronExpression);
        return reply.status(400).send({ error: "Invalid cron expression" });
    }

    // Schedule the cron job
    try {
        cron.schedule(cronExpression, autoFetchComments);
        console.log("Cron job scheduled with expression:", cronExpression);
    } catch (error) {
        console.error("Error scheduling cron job:", error);
        return reply.status(500).send({ error: "Failed to schedule cron job" });
    }

    reply.redirect("/");
});

// Start Fastify server
fastify.listen({ port: 3000 }, (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server listening at ${address}`);
});

// Fetch comments on startup
autoFetchComments();
