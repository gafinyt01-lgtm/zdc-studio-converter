const { Pool } = require('@neondatabase/serverless');

let pool;

function getPool() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL belum diatur');
    }

    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL
        });
    }

    return pool;
}

module.exports = { getPool };
