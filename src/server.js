'use strict';

const path = require('node:path');
const { openDatabase } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'resource-pool.db');

const db = openDatabase(DB_FILE);
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`Resource pool running at http://localhost:${PORT} (db: ${DB_FILE})`);
});
