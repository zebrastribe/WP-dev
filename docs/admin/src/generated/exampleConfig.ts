/* eslint-disable */
/** Auto-generated from wp-dev.config.example.json — run `npm run generate:config-artifacts` */
export const EXAMPLE_WP_DEV_CONFIG = {
  "project": "my-site",
  "local": {
    "url": "http://localhost:8888",
    "path": "./docker",
    "composeFile": "docker-compose.yml",
    "composeService": "wpcli",
    "wpRoot": "./wordpress"
  },
  "staging": {
    "host": "staging.example.invalid",
    "user": "deploy",
    "path": "/var/www/staging-not-used",
    "url": "https://staging.example.invalid"
  },
  "production": {
    "host": "example.com",
    "user": "deploy",
    "path": "/var/www/live",
    "url": "https://example.com"
  },
  "sync": {
    "plugins": {
      "query-monitor": "localOnly"
    },
    "themes": {},
    "disabledRecommended": [],
    "skipUploadsOnPush": false
  }
} as const;
