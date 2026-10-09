import { Pool } from '@neondatabase/serverless';

let pool;

export function getPool() {
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
