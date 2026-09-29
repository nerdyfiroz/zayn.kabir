import { MongoClient } from 'mongodb';

// Cache the MongoDB client connection across serverless invocations
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL || process.env.MONGODB_URL || process.env.DATABASE_URL;
  if (!uri) {
    return null;
  }

  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  try {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });
    await client.connect();
    
    // Resolve database name from environment variables or connection URI
    const explicitDbName = 
      process.env.MONGODB_DB ||
      process.env.MONGODB_DATABASE ||
      process.env.MONGO_DATABASE ||
      process.env.MONGO_DB ||
      process.env.DATABASE_NAME ||
      process.env.DB_NAME;

    let dbName = explicitDbName;
    if (!dbName) {
      // If client URI provided a specific database name other than default 'test'
      if (client.options?.dbName && client.options.dbName !== 'test') {
        dbName = client.options.dbName;
      } else {
        dbName = 'zayn_portfolio';
      }
    }

    const db = client.db(dbName);
    console.log(`[MongoDB] Connected successfully to database: "${db.databaseName}"`);
    
    cachedClient = client;
    cachedDb = db;
    return { client, db };
  } catch (err) {
    console.error('[MongoDB] Connection error:', err.message);
    return null;
  }
}

// Telegram notification sender
async function sendTelegramNotification({ subject, offerPrice, email, contactMethod, otherMethodName, contactHandle, projectDetails }) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || process.env.BOT_TOKEN;
  // User specified @zaynkabirweb3; bot can send to chat_id or public channel/username if configured
  const chatId = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHATID || process.env.CHAT_ID || process.env.TELEGRAM_TO || '@zaynkabirweb3';

  if (!token) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN is not configured. Notification skipped.');
    return false;
  }

  const methodDisplay = contactMethod === 'other' && otherMethodName 
    ? `Other (${otherMethodName})` 
    : (contactMethod ? contactMethod.toUpperCase() : 'Not Specified');

  const text = 
`🚀 *New Website / Project Request!*

📌 *Subject:* ${subject}
💰 *Offer Price:* ${offerPrice || '$50 (Minimum)'}
✉️ *Email:* ${email}
💬 *Contact Method:* ${methodDisplay}
🆔 *Handle / Info:* ${contactHandle || 'Not provided'}

📝 *Project Details:*
${projectDetails}

⏰ *Received:* ${new Date().toUTCString()}
👤 *Assignee:* @zaynkabirweb3`;

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });

    const data = await response.json();
    if (!data.ok) {
      // Retry without markdown in case of formatting characters
      const plainText = text.replace(/[*_`]/g, '');
      const retryResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: plainText
        })
      });
      const retryData = await retryResponse.json();
      if (!retryData.ok) {
        console.error('[Telegram] API Error:', retryData.description);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error('[Telegram] Notification error:', err.message);
    return false;
  }
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { subject, offerPrice, customOffer, email, contactMethod, otherMethodName, contactHandle, projectDetails } = req.body || {};

    // Validate required fields
    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      return res.status(400).json({ error: 'Please provide a project subject.' });
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    // Validate Offer Price (Minimum $25 USD)
    let parsedOfferString = '$50';
    let numericOfferAmount = 50;

    if (offerPrice === 'custom') {
      const parsedCustom = Number(String(customOffer).replace(/[^0-9.]/g, ''));
      if (isNaN(parsedCustom) || parsedCustom < 25) {
        return res.status(400).json({ 
          error: 'Offer price must be at least $25.' 
        });
      }
      numericOfferAmount = parsedCustom;
      parsedOfferString = `$${parsedCustom}`;
    } else if (offerPrice) {
      const parsedPreset = Number(String(offerPrice).replace(/[^0-9.]/g, ''));
      if (isNaN(parsedPreset) || parsedPreset < 25) {
        return res.status(400).json({ 
          error: 'Offer price must be at least $25.' 
        });
      }
      numericOfferAmount = parsedPreset;
      parsedOfferString = `$${parsedPreset}`;
    } else {
      return res.status(400).json({ error: 'Please select an offer price.' });
    }

    if (!projectDetails || typeof projectDetails !== 'string' || !projectDetails.trim()) {
      return res.status(400).json({ error: 'Please provide details about your project.' });
    }

    const cleanData = {
      subject: subject.trim(),
      offerPrice: parsedOfferString,
      offerAmount: numericOfferAmount,
      email: email.trim().toLowerCase(),
      contactMethod: (contactMethod || 'email').trim().toLowerCase(),
      otherMethodName: otherMethodName ? otherMethodName.trim() : '',
      contactHandle: contactHandle ? contactHandle.trim() : '',
      projectDetails: projectDetails.trim(),
      status: 'pending',
      targetTelegram: '@zaynkabirweb3',
      createdAt: new Date(),
    };

    // 1. Store in MongoDB if configured
    let mongoSaved = false;
    try {
      const dbConnection = await connectToDatabase();
      if (dbConnection && dbConnection.db) {
        const collectionName = process.env.MONGODB_COLLECTION || 'project_requests';
        const result = await dbConnection.db.collection(collectionName).insertOne({
          ...cleanData,
          clientMeta: {
            ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
            userAgent: req.headers['user-agent'] || null
          }
        });
        mongoSaved = Boolean(result.insertedId);
        console.log(`[MongoDB] Saved inquiry ID: ${result.insertedId} in "${dbConnection.db.databaseName}.${collectionName}"`);
      }
    } catch (dbErr) {
      console.error('[Database] Failed to insert inquiry:', dbErr.message);
    }

    // 2. Dispatch silent Telegram notification
    let telegramNotified = false;
    try {
      telegramNotified = await sendTelegramNotification(cleanData);
      if (telegramNotified) {
        console.log('[Telegram] Notification successfully sent.');
      }
    } catch (tgErr) {
      console.error('[Telegram] Dispatch failed:', tgErr.message);
    }

    // 3. Respond cleanly to user (they cannot detect backend infrastructure details)
    return res.status(200).json({
      success: true,
      message: 'Your project inquiry has been successfully submitted! I will review the specifications and get in touch with you shortly.',
      id: cleanData.createdAt.getTime()
    });
  } catch (error) {
    console.error('[Contact API] Internal Error:', error);
    return res.status(500).json({
      error: 'An unexpected error occurred while processing your request. Please try again or reach out on X directly.'
    });
  }
}
