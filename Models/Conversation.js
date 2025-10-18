// models/Conversation.js
const mongoose = require('mongoose');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const ungzip = promisify(zlib.gunzip);
const { Schema } = mongoose;
const crypto = require('crypto');

// Message shape (stored inside compressed segments)
/*
{
  _id: ObjectId,
  sender: ObjectId,
  senderSnapshot: { name, facultyID, college, department },
  type: 'positive'|'negative'|'system',
  content: { text: String, meta: Object },
  createdAt: Date
}
*/

const SEGMENT_MESSAGE_LIMIT = 100;       // number of messages per compressed segment (tunable)
const SEGMENT_BYTE_THRESHOLD = 64 * 1024; // 64KB per segment preferred max (tunable)

const messageSegmentSchema = new Schema(
  {
    // compressed blob: gzip Buffer
    data: { type: Buffer, required: true },
    messageCount: { type: Number, required: true },
    firstMessageAt: { type: Date, required: true },
    lastMessageAt: { type: Date, required: true },
    checksum: { type: String, required: true }, // optional integrity check
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const conversationSchema = new Schema(
  {
    credit: { type: Schema.Types.ObjectId, ref: 'Credit', required: true },
    participants: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['open', 'resolved', 'archived'], default: 'open' },

    // compressed history segments (append-only)
    messageSegments: { type: [messageSegmentSchema], default: [] },

    // cached last message summary for quick listing
    lastMessage: {
      text: String,
      sender: { type: Schema.Types.ObjectId, ref: 'User' },
      createdAt: Date,
      type: String,
    },

    // metrics:
    totalMessages: { type: Number, default: 0 },
    unreadCounts: { type: Map, of: Number, default: {} }, // per user unread counts
  },
  { timestamps: true }
);

/**
 * Utility to compress an array of message objects (JSON serializable) -> gzip Buffer
 */
async function compressMessages(messagesArray) {
  const json = JSON.stringify(messagesArray);
  const buf = Buffer.from(json, 'utf8');
  const compressed = await gzip(buf);
  return compressed;
}

/**
 * Decompress gzip Buffer -> messages array
 */
async function decompressMessages(buffer) {
  const decompressed = await ungzip(buffer);
  const json = decompressed.toString('utf8');
  return JSON.parse(json);
}

/**
 * Helper: generate checksum for compressed buffer
 */
function checksumBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Append a single message into the conversation by adding to the last segment (decompress/recompress) or creating a new segment.
 * We handle concurrency with a findOneAndUpdate optimistic retry loop.
 */
conversationSchema.statics.appendMessage = async function (conversationId, message) {
  const Conversation = this;
  const MAX_RETRIES = 5;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // get conversation snapshot
    const convo = await Conversation.findById(conversationId).select('messageSegments totalMessages lastMessage participants').exec();
    if (!convo) throw new Error('Conversation not found');

    const segments = convo.messageSegments || [];
    const lastSegment = segments.length ? segments[segments.length - 1] : null;

    // If no segment exists, create a fresh one with this message
    if (!lastSegment) {
      const messages = [{ ...message, _id: new mongoose.Types.ObjectId() }];
      const compressed = await compressMessages(messages);
      const newSegment = {
        data: compressed,
        messageCount: messages.length,
        firstMessageAt: message.createdAt,
        lastMessageAt: message.createdAt,
        checksum: checksumBuffer(compressed),
      };

      // push atomically
      const updated = await Conversation.findOneAndUpdate(
        { _id: conversationId, messageSegments: { $size: 0 } }, // only if no segments to avoid race
        {
          $push: { messageSegments: newSegment },
          $inc: { totalMessages: 1 },
          $set: { lastMessage: { text: message.content.text, sender: message.sender, createdAt: message.createdAt, type: message.type } },
        },
        { new: true }
      ).exec();

      if (updated) return updated;
      // else retry (another process may have created a segment)
      continue;
    }

    // Decompress last segment to append if within limits
    const decompressed = await decompressMessages(lastSegment.data); // array of messages
    const willExceedMessageCount = decompressed.length + 1 > SEGMENT_MESSAGE_LIMIT;
    const candidateJsonSize = Buffer.byteLength(JSON.stringify(decompressed), 'utf8') + Buffer.byteLength(JSON.stringify(message), 'utf8');
    const willExceedByteLimit = candidateJsonSize > SEGMENT_BYTE_THRESHOLD;

    if (willExceedMessageCount || willExceedByteLimit) {
      // create a new segment instead of appending
      const newMessages = [{ ...message, _id: new mongoose.Types.ObjectId() }];
      const compressedNew = await compressMessages(newMessages);
      const segmentObj = {
        data: compressedNew,
        messageCount: 1,
        firstMessageAt: message.createdAt,
        lastMessageAt: message.createdAt,
        checksum: checksumBuffer(compressedNew),
      };

      const updated = await Conversation.findOneAndUpdate(
        { _id: conversationId, 'messageSegments._id': lastSegment._id }, // ensure not modified
        {
          $push: { messageSegments: segmentObj },
          $inc: { totalMessages: 1 },
          $set: { lastMessage: { text: message.content.text, sender: message.sender, createdAt: message.createdAt, type: message.type } },
        },
        { new: true }
      ).exec();

      if (updated) return updated;
      // else retry
      continue;
    }

    // else append to last segment: modify the decompressed array and recompress
    decompressed.push({ ...message, _id: new mongoose.Types.ObjectId() });
    const recompressed = await compressMessages(decompressed);
    const updatedSegment = {
      'messageSegments.$.data': recompressed,
      'messageSegments.$.messageCount': decompressed.length,
      'messageSegments.$.lastMessageAt': message.createdAt,
      'messageSegments.$.checksum': checksumBuffer(recompressed),
    };

    // We must locate the conversation where last segment checksum matches to avoid race condition
    const query = {
      _id: conversationId,
      'messageSegments.messageCount': lastSegment.messageCount,
      'messageSegments.lastMessageAt': lastSegment.lastMessageAt,
      'messageSegments.checksum': lastSegment.checksum,
    };

    // findOneAndUpdate using positional operator $ to update last matching segment
    const updated = await Conversation.findOneAndUpdate(
      query,
      {
        $set: updatedSegment,
        $inc: { totalMessages: 1 },
        $setOnInsert: {},
        $set: { lastMessage: { text: message.content.text, sender: message.sender, createdAt: message.createdAt, type: message.type } },
      },
      { new: true }
    ).exec();

    if (updated) return updated;

    // If update failed due to mismatch, retry
  }

  throw new Error('Failed to append message after retries');
};

/**
 * Read messages paginated.
 * options: { limit (default 50), before (ISO timestamp string - return messages before this timestamp) }
 *
 * Implementation: iterate segments from last to first, decompress only needed segments until we gather limit messages,
 * then return messages in chronological order.
 */
conversationSchema.statics.getMessagesPaginated = async function (conversationId, options = {}) {
  const Conversation = this;
  const limit = Math.min(options.limit || 50, 500);
  const before = options.before ? new Date(options.before) : null;

  const convo = await Conversation.findById(conversationId).select('messageSegments').lean();
  if (!convo) throw new Error('Conversation not found');

  const segments = convo.messageSegments || [];
  const results = [];

  // iterate from last segment backwards
  for (let i = segments.length - 1; i >= 0 && results.length < limit; i--) {
    const seg = segments[i];

    // quick skip: if before is set and seg.firstMessageAt >= before and seg.lastMessageAt >= before -> we need to decompress to filter
    // We'll decompress and filter messages within the segment
    const messages = await decompressMessages(seg.data); // chronological within segment
    // filter by before
    const filtered = before ? messages.filter(m => new Date(m.createdAt) < before) : messages;
    // add from end of filtered since iterating from newest segments
    for (let j = filtered.length - 1; j >= 0 && results.length < limit; j--) {
      results.push(filtered[j]);
    }
  }

  // results are newest->oldest, we need chronological order
  results.reverse();
  return results;
};

conversationSchema.index({ credit: 1 });
conversationSchema.index({ participants: 1 });
conversationSchema.index({ updatedAt: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);
module.exports = Conversation;
