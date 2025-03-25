const { exec } = require('child_process');
const inquirer = require('inquirer');

async function checkBun() {
    exec('bun --version', (error, stdout, stderr) => {
        if (error) {
            console.log('Bun.js is not installed.');
            askInstallBun();
        } else {
            console.log(`Bun.js is already installed: ${stdout}`);
            proceedWithInstall();
        }
    });
}

async function askInstallBun() {
    const answers = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'installBun',
            message: 'Bun.js is not installed. Do you want to install it?',
            default: false,
        },
    ]);

    if (answers.installBun) {
        console.log('Installing Bun.js...');
        installBun();
    } else {
        console.log('Exiting...');
        process.exit(0);
    }
}

function installBun() {
    exec('curl -fsSL https://bun.sh/install | bash', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error installing Bun.js: ${stderr}`);
            process.exit(1);
        }
        console.log(`Bun.js installed successfully!`);
        proceedWithInstall();
    });
}

function proceedWithInstall() {
    console.log('Now installing npm modules in the background...');

    // Execute npm install in the background
    exec('npm i', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error during npm install: ${stderr}`);
            process.exit(1);
        }
        console.log('Modules installed successfully!');
        startServer();
    });
}

function startServer() {
    console.log('Starting server...');

    console.log('Server started successfully!');
    console.log('Go to http://localhost:3000/');

    // Execute the server in the background
    exec('npm start', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error starting server: ${stderr}`);
            process.exit(1);
        }
    });
}

// Check if Bun is installed
checkBun();
