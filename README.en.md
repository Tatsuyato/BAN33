# MAX 33 Comment Manager

<div align="center">

[![English](https://img.shields.io/badge/lang-English-blue?style=for-the-badge&logo=github)](README.en.md)
[![ภาษาไทย](https://img.shields.io/badge/lang-ภาษาไทย-brightgreen?style=for-the-badge&logo=github)](README.th.md)

</div>

# MAX 33 Comment Manager

A simple tool for managing and monitoring YouTube comments, specifically designed to detect and manage "MAX 33" spam comments. Just run the `Run.exe` file, prepare your Google API Key and YouTube Channel ID, and get started!

## Technology Change

This project initially started with `bun.js`, but due to compatibility issues with the API in use, it was switched to `ts-node` during development to facilitate running TypeScript code.

### Running the Project with ts-node
1. Navigate to the project folder:
   ```bash
   cd /path/to/project
   ```
2. Run the main TypeScript file:
   ```bash
   ts-node src/index.ts
   ```

### Note
- Reverting to `bun.js` will be reconsidered once API support is fully compatible.
- If you encounter issues with `ts-node`, ensure that your Node.js and TypeScript versions are up to date.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Tatsuyato/BAN33&type=Date)](https://www.star-history.com/#Tatsuyato/BAN33&Date)

## Features
- Monitor comments on your YouTube channel
- Detect duplicate comments (e.g., repeated "MAX 33") and classify them as spam
- Admin dashboard for spam statistics
- Easy setup with a user-friendly interface

## Requirements
Before running the application, make sure you have:
1. **Google API Key** with YouTube Data API v3 enabled
2. **YouTube Channel ID** of the channel you want to monitor

## Setup Steps

### Step 1: Enable YouTube Data API
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
2. Search for "YouTube Data API v3" in the API Library
3. Click "Enable" to activate the API for your project (*Note: You must manually enable this API at https://console.cloud.google.com/apis/library/youtube.googleapis.com*)

### Step 2: Get a Google API Key
1. In Google Cloud Console, go to **APIs & Services > Credentials**
2. Click **Create Credentials** and select **API Key**
3. Copy the generated API Key and save it for use

### Step 3: Find Your YouTube Channel ID
1. Go to your YouTube channel
2. View the page source (Right-click > View Page Source) or check the URL
3. Look for `channelId` or copy the ID from the URL (e.g., `UCxxxxxxxxxxxxxxxxxxxxxx`)

### Step 4: Run the Application
1. Download and extract the project files
2. Run the `Run.exe` file
3. In the settings window:
   - Enter your **Google API Key**
   - Enter your **YouTube Channel ID**
   - (Optional) Set the scan interval (days, hours, minutes) or leave it as `*` for continuous monitoring
   - Click **Save Settings**

## Usage
- Once configured, the application will begin monitoring comments on your channel.
- Access the admin dashboard at `http://localhost:3000` (or your specified port) to view:
  - Total comments
  - Number of spam comments (e.g., duplicate "MAX 33" entries)
  - Spam percentage
  - Number of users posting spam
- Comments marked as spam will be highlighted for easy review.

## Notes
- The application considers duplicate comments (same ID and content) as spam.
- Ensure your API Key has the necessary permissions and quota for YouTube Data API usage.
- Use `*` in the scheduling field for continuous monitoring.

## Troubleshooting
- **Settings window keeps appearing?** Check if your API Key and Channel ID are correctly saved.
- **No comments appearing?** Verify your Channel ID and confirm that your API Key has access to YouTube Data API.

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributions
Feedback and contributions are welcome to further improve this tool!

