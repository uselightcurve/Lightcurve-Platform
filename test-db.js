const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:%40AYUSHSAXENa21@34.172.66.181:5432/postgres",
  connectionTimeoutMillis: 5000,
});

async function testConnection() {
  console.log('Attempting to connect to database...');
  try {
    await client.connect();
    console.log('Successfully connected to database!');
    const res = await client.query('SELECT NOW()');
    console.log('Query result:', res.rows[0]);
  } catch (err) {
    console.error('Connection error', err.stack);
  } finally {
    await client.end();
  }
}

testConnection();
