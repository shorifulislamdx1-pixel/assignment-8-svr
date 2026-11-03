
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');
const { z } = require('zod');
require('dotenv').config();

const app = express();
const BOOK_CATEGORIES = ['Fiction', 'Science', 'History', 'Kids', 'Others'];
const globalState = globalThis;

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

async function getDb() {
  if (globalState.__bookNookDb) return globalState.__bookNookDb;

  if (!globalState.__bookNookDbPromise) {
    const uri = process.env.MONGODB_URI;

    if (!uri) throw new Error('MONGODB_URI is not configured.');

    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
    });

    globalState.__bookNookDbPromise = client.connect().then((connected) => {
      globalState.__bookNookMongoClient = connected;
      globalState.__bookNookDb = connected.db(process.env.MONGODB_DB || 'booknook');
      return globalState.__bookNookDb;
    }).catch((error) => {
      globalState.__bookNookDbPromise = undefined;
      throw error;
    });
  }

  return globalState.__bookNookDbPromise;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function asyncRoute(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return next(new HttpError(401, 'Authentication required.'));
  }

  const token = header.slice(7).trim();
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return next(new HttpError(500, 'Server misconfiguration: JWT_SECRET missing.'));
  }

  try {
    const payload = jwt.verify(token, secret, {
      issuer: process.env.JWT_ISSUER || 'booknook-web',
      audience: process.env.JWT_AUDIENCE || 'booknook-api',
      algorithms: ['HS256'],
    });

    if (!payload || typeof payload !== 'object' || !payload.sub || !payload.email) {
      return next(new HttpError(401, 'Invalid authentication token.'));
    }

    req.authUser = {
      id: String(payload.sub),
      email: String(payload.email),
      name: typeof payload.name === 'string'
        ? payload.name
        : String(payload.email).split('@')[0],
      image: typeof payload.image === 'string' ? payload.image : null,
    };

    return next();
  } catch (_error) {
    return next(new HttpError(401, 'Your session has expired. Please sign in again.'));
  }
}

const imageSchema = z.string().trim().min(1, 'A book cover is required.').refine(
  (value) => /^https?:\/\//i.test(value) || value.startsWith('/'),
  'Enter a valid image URL.'
);

const createBookSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(140),
  author: z.string().trim().min(1, 'Author is required.').max(120),
  category: z.enum(BOOK_CATEGORIES),
  image: imageSchema,
  description: z.string().trim().min(10, 'Description should be at least 10 characters.').max(3000),
  totalCopies: z.number().int('Copies must be a whole number.').min(1, 'Add at least one copy.').max(100),
});

const updateBookSchema = createBookSchema.partial().extend({
  totalCopies: z.number().int().min(0).max(100).optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Add at least one field to update.' }
);

const createBorrowSchema = z.object({
  bookId: z.string().trim().min(1, 'A book is required.'),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid return date.'),
});

function safeToISO(value) {
  if (!value) return new Date().toISOString();

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toBookResponse(book) {
  return {
    ...book,
    _id: book._id ? String(book._id) : undefined,
    userId: book.userId || 'booknook-curator',
    userEmail: book.userEmail || 'curator@booknook.app',
    userName: book.userName || 'BookNook Curator',
    totalCopies: typeof book.totalCopies === 'number' ? book.totalCopies : 1,
    createdAt: safeToISO(book.createdAt),
    updatedAt: safeToISO(book.updatedAt || book.createdAt),
  };
}

function toBorrowResponse(borrow) {
  return {
    ...borrow,
    _id: String(borrow._id),
    bookId: String(borrow.bookId),
    borrowDate: safeToISO(borrow.borrowDate),
    returnDate: safeToISO(borrow.returnDate),
  };
}

function parseObjectId(value, message = 'Book not found.') {
  if (!ObjectId.isValid(value)) throw new HttpError(404, message);
  return new ObjectId(value);
}

function canManageBook(book, user) {
  return book.userId === user.id || book.userEmail === user.email;
}

function validate(schema, value) {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message || 'Invalid request.');
  }

  return result.data;
}

app.get('/', (_req, res) => {
  res.json({ success: true, message: 'BookNook API is running.' });
});

app.get('/health', (_req, res) => {
  res.json({ success: true, status: 'ok' });
});

// Public book catalogue.
app.get('/books', asyncRoute(async (req, res) => {
  const db = await getDb();

  const category = typeof req.query.category === 'string'
    ? req.query.category
    : '';

  const search = typeof req.query.q === 'string'
    ? req.query.q.trim().slice(0, 120)
    : '';

  const sort = typeof req.query.sort === 'string'
    ? req.query.sort
    : 'newest';

  const parsedLimit = Number(req.query.limit);

  const limit = Number.isFinite(parsedLimit) && req.query.limit !== undefined
    ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 100)
    : 100;

  const filter = {};

  if (BOOK_CATEGORIES.includes(category)) {
    filter.category = category;
  }

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(escaped, 'i');

    filter.$or = [
      { title: expression },
      { author: expression },
      { description: expression },
    ];
  }

  const sortMap = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    title: { title: 1 },
    author: { author: 1 },
  };

  const books = await db.collection('books')
    .find(filter)
    .sort(sortMap[sort] || sortMap.newest)
    .limit(limit)
    .toArray();

  res.json(books.map(toBookResponse));
}));

app.get('/books/mine', requireAuth, asyncRoute(async (req, res) => {
  const db = await getDb();

  const books = await db.collection('books').find({
    $or: [
      { userId: req.authUser.id },
      { userEmail: req.authUser.email },
    ],
  }).sort({ createdAt: -1 }).toArray();

  res.json(books.map(toBookResponse));
}));

app.get('/books/:id', asyncRoute(async (req, res) => {
  const db = await getDb();

  const book = await db.collection('books').findOne({
    _id: parseObjectId(req.params.id),
  });

  if (!book) throw new HttpError(404, 'Book not found.');

  res.json(toBookResponse(book));
}));

app.post('/books', requireAuth, asyncRoute(async (req, res) => {
  const input = validate(createBookSchema, req.body || {});
  const db = await getDb();
  const books = db.collection('books');

  const escapeRegex = (value) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const existingBook = await books.findOne({
    title: {
      $regex: `^${escapeRegex(input.title.trim())}$`,
      $options: 'i',
    },
    author: {
      $regex: `^${escapeRegex(input.author.trim())}$`,
      $options: 'i',
    },
  });

  if (existingBook) {
    throw new HttpError(409, 'This book already exists in the collection.');
  }

  const now = new Date();

  const book = {
    ...input,
    userId: req.authUser.id,
    userEmail: req.authUser.email,
    userName: req.authUser.name,
    createdAt: now,
    updatedAt: now,
  };

  const result = await books.insertOne(book);

  res.status(201).json(toBookResponse({
    ...book,
    _id: result.insertedId,
  }));
}));

app.patch('/books/:id', requireAuth, asyncRoute(async (req, res) => {
  const input = validate(updateBookSchema, req.body || {});
  const db = await getDb();
  const books = db.collection('books');
  const _id = parseObjectId(req.params.id);

  const existing = await books.findOne({ _id });

  if (!existing) throw new HttpError(404, 'Book not found.');

  if (!canManageBook(existing, req.authUser)) {
    throw new HttpError(403, 'You can only edit books you added.');
  }

  const updated = await books.findOneAndUpdate(
    { _id },
    { $set: { ...input, updatedAt: new Date() } },
    { returnDocument: 'after', includeResultMetadata: false }
  );

  if (!updated) throw new HttpError(404, 'Book not found.');

  res.json(toBookResponse(updated));
}));

app.delete('/books/:id', requireAuth, asyncRoute(async (req, res) => {
  const db = await getDb();
  const _id = parseObjectId(req.params.id);
  const books = db.collection('books');

  const existing = await books.findOne({ _id });

  if (!existing) throw new HttpError(404, 'Book not found.');

  if (!canManageBook(existing, req.authUser)) {
    throw new HttpError(403, 'You can only delete books you added.');
  }

  const activeBorrows = await db.collection('borrows').countDocuments({
    bookId: _id,
    status: 'active',
  });

  if (activeBorrows > 0) {
    throw new HttpError(
      409,
      'This book is currently borrowed. Wait for it to be returned before deleting it.'
    );
  }

  await books.deleteOne({ _id });

  res.json({ message: 'Book deleted successfully.' });
}));

app.get('/borrows', requireAuth, asyncRoute(async (req, res) => {
  const db = await getDb();

  const borrows = await db.collection('borrows').find({
    $or: [
      { userId: req.authUser.id },
      { userEmail: req.authUser.email },
    ],
    status: 'active',
  }).sort({ borrowDate: -1 }).toArray();

  res.json(borrows.map(toBorrowResponse));
}));

app.post('/borrows', requireAuth, asyncRoute(async (req, res) => {
  const input = validate(createBorrowSchema, req.body || {});
  const bookId = parseObjectId(input.bookId);

  const today = new Date().toISOString().slice(0, 10);

  if (input.returnDate < today) {
    throw new HttpError(400, 'The return date cannot be in the past.');
  }

  const maxReturn = new Date();
  maxReturn.setUTCDate(maxReturn.getUTCDate() + 60);

  if (input.returnDate > maxReturn.toISOString().slice(0, 10)) {
    throw new HttpError(400, 'Books can be borrowed for up to 60 days.');
  }

  const db = await getDb();
  const books = db.collection('books');
  const borrows = db.collection('borrows');

  const book = await books.findOne({ _id: bookId });

  if (!book) throw new HttpError(404, 'Book not found.');

  if (canManageBook(book, req.authUser)) {
    throw new HttpError(400, 'You cannot borrow a book you added.');
  }

  const existing = await borrows.findOne({
    bookId,
    status: 'active',
    $or: [
      { userId: req.authUser.id },
      { userEmail: req.authUser.email },
    ],
  });

  if (existing) {
    throw new HttpError(409, 'You already have this book borrowed.');
  }

  const inventory = await books.updateOne(
    { _id: bookId, totalCopies: { $gt: 0 } },
    {
      $inc: { totalCopies: -1 },
      $set: { updatedAt: new Date() },
    }
  );

  if (inventory.modifiedCount !== 1) {
    throw new HttpError(
      409,
      'All copies of this book are currently borrowed. Check back soon.'
    );
  }

  const borrow = {
    bookId,
    bookTitle: book.title,
    bookAuthor: book.author,
    bookImage: book.image,
    userId: req.authUser.id,
    userEmail: req.authUser.email,
    userName: req.authUser.name,
    borrowDate: new Date(),
    returnDate: new Date(`${input.returnDate}T12:00:00.000Z`),
    status: 'active',
  };

  try {
    const result = await borrows.insertOne(borrow);

    res.status(201).json(toBorrowResponse({
      ...borrow,
      _id: result.insertedId,
    }));
  } catch (error) {
    await books.updateOne(
      { _id: bookId },
      {
        $inc: { totalCopies: 1 },
        $set: { updatedAt: new Date() },
      }
    );

    throw error;
  }
}));

app.delete('/borrows/:id', requireAuth, asyncRoute(async (req, res) => {
  const _id = parseObjectId(req.params.id, 'Borrow record not found.');
  const db = await getDb();
  const borrows = db.collection('borrows');

  const borrow = await borrows.findOneAndDelete({
    _id,
    $or: [
      { userId: req.authUser.id },
      { userEmail: req.authUser.email },
    ],
    status: 'active',
  });

  if (!borrow) {
    throw new HttpError(404, 'Active borrow record not found.');
  }

  await db.collection('books').updateOne(
    { _id: borrow.bookId },
    {
      $inc: { totalCopies: 1 },
      $set: { updatedAt: new Date() },
    }
  );

  res.json({ message: 'Book returned successfully.' });
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter(_req, file, callback) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) {
      return callback(
        new HttpError(400, 'Only JPG, PNG, WEBP and GIF images are allowed.')
      );
    }

    callback(null, true);
  },
});

app.post('/upload', requireAuth, upload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) {
    throw new HttpError(400, 'Please select an image to upload.');
  }

  const apiKey = process.env.IMGBB_API_KEY || process.env.NEXT_PUBLIC_IMGBB_API_KEY;

  if (!apiKey) {
    throw new HttpError(500, 'IMGBB_API_KEY is not configured on the backend.');
  }

  const form = new URLSearchParams();
  form.set('image', req.file.buffer.toString('base64'));

  const response = await fetch(
    `https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      body: form,
    }
  );

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.success || typeof result?.data?.url !== 'string') {
    console.error('ImgBB upload failed:', result);
    throw new HttpError(502, 'Image upload provider rejected the image.');
  }

  res.status(201).json({ url: result.data.url });
}));

app.get('/api/protected', requireAuth, (req, res) => {
  res.json({
    success: true,
    message: 'You have successfully accessed a protected API!',
    user: req.authUser,
  });
});

app.use((req, res, next) => {
  next(new HttpError(404, 'API route not found.'));
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      message: error.code === 'LIMIT_FILE_SIZE'
        ? 'Image must be 5 MB or smaller.'
        : 'Invalid upload.',
    });
  }

  const status = Number.isInteger(error.status) ? error.status : 500;

  if (status >= 500) {
    console.error('BookNook API error:', error);
  }

  return res.status(status).json({
    message: status >= 500
      ? 'An unexpected server error occurred.'
      : error.message,
  });
});

module.exports = app;
