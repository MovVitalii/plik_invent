"use strict";

const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const appDir = path.join(root, "apps", "materials");
const port = "8804";

function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: "inherit", ...options });
        child.on("error", reject);
        child.on("exit", (code, signal) => {
            if (signal) reject(new Error(`${command} terminated by ${signal}`));
            else resolve(code ?? 1);
        });
    });
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
    const server = spawn("python3", ["-m", "http.server", port, "--bind", "127.0.0.1"], {
        cwd: appDir,
        stdio: ["ignore", "ignore", "inherit"]
    });

    let serverFailed = null;
    server.on("error", (error) => { serverFailed = error; });
    server.on("exit", (code) => {
        if (code && code !== 0) serverFailed = new Error(`Test server exited with code ${code}.`);
    });

    try {
        await wait(800);
        if (serverFailed) throw serverFailed;
        const tests = ["static-audit-test.js", "integration-test.js", "data-lab-test.js", "audit-regression-test.js", "performance-test.js"];
        for (const test of tests) {
            const code = await run(process.execPath, [path.join(__dirname, test)], { cwd: root });
            if (code !== 0) process.exitCode = code;
            if (code !== 0) return;
        }
    } finally {
        if (!server.killed) server.kill("SIGTERM");
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
