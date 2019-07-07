/**
 * Database Setup file.
 * 
 * @description
 * Provides an export of the Pool object from node-postgres to facilitate 
 * easy querying of a postgres database. Database connection configuration
 * is handled by config.js
 */

const { Pool } = require('pg');
const { connectionInfo } = require('./config');

const db = new Pool({
    user: connectionInfo.user,
    password: connectionInfo.password,
    host: connectionInfo.host,
    port: connectionInfo.port,
    database: "Robots"
});

module.exports = db;