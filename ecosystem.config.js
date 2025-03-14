module.exports = {
    apps: [
    {
        name: "WhatsTelBridgeJS",
        script: "index.js",
        watch: false,
        max_memory_restart: "500M",
        env: {
            NODE_ENV: "production",
        },
        autorestart: true,
        restart_delay: 5000,
        max_restarts: 10,
        exp_backoff_restart_delay: 100,
    },
    ],
}