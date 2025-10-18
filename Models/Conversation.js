// models/Conversation.js
const mongoose = require('mongoose');
const zlib = require('zlib');
const { promisify } = require('util');
const crypto = require('crypto');

const gzip = promisify(zlib.gzip);
const ungzip = promisify(zlib.gunzip); // gunzip works on gzip buffers
const { Schema } = mongoose;

/* -------------------------
   Constants
------------------------- */
const SEGMENT_MESSAGE_LIMIT = 100;        // max messages per compressed segment
const SEGMENT_BYTE_THRESHOLD = 64 * 1024; // ~64KB per segment

/* -------------------------
   Message Segment Schema
------------------------- */
const messageSegmentSchema = new Schema({
  data: { type: Buffer, required: true }, // compressed gzip buffer
  messageCount: { type: Number, required: true },
  firstMessageAt: { type: Date, required: true },
  lastMessageAt: { type: Date, required: true },
  checksum: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

/* -------------------------
   Conversation Schema
------------------------- */
const conversationSchema = new Schema({
  credit: { type: Schema.Types.ObjectId, ref: 'Credit', required: true },
  participants: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['open', 'resolved', 'archived'], default: 'open' },

  messageSegments: { type: [messageSegmentSchema], default: [] },

  lastMessage: {
    text: String,
    sender: { type: Schema.Types.ObjectId, ref: 'User' },
    createdAt: Date,
    type: String,
  },

  totalMessages: { type: Number, default: 0 },
  unreadCounts: { type: Map, of: Number, default: {} },
}, { timestamps: true });

/* -------------------------
   Utilities: compress / decompress
------------------------- */
async function compressMessages(messagesArray) {
  const json = JSON.stringify(messagesArray);
  return await gzip(Buffer.from(json, 'utf8'));
}

async function decompressMessages(binary) {
  // Convert MongoDB Binary to Node.js Buffer
  const buffer = Buffer.isBuffer(binary) ? binary : Buffer.from(binary.buffer);
  const decompressed = await ungzip(buffer);
  return JSON.parse(decompressed.toString('utf8'));
}

function checksumBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/* -------------------------
   Append a message
------------------------- */
conversationSchema.statics.appendMessage = async function (conversationId, message) {
  const Conversation = this;
  const MAX_RETRIES = 5;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const convo = await Conversation.findById(conversationId)
      .select('messageSegments totalMessages lastMessage participants')
      .exec();
    if (!convo) throw new Error('Conversation not found');

    const segments = convo.messageSegments || [];
    const lastSegment = segments.length ? segments[segments.length - 1] : null;

    const lastMessageFields = {
      'lastMessage.text': message.content?.text || '',
      'lastMessage.sender': message.sender,
      'lastMessage.createdAt': message.createdAt,
      'lastMessage.type': message.type,
    };

    // --- If no segments, create the first one ---
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

      const updated = await Conversation.findOneAndUpdate(
        { _id: conversationId, messageSegments: { $size: 0 } },
        {
          $push: { messageSegments: newSegment },
          $inc: { totalMessages: 1 },
          $set: lastMessageFields,
        },
        { new: true }
      ).exec();

      if (updated) return updated;
      continue;
    }

    // --- Decompress last segment ---
    const decompressed = await decompressMessages(lastSegment.data);
    const willExceedCount = decompressed.length + 1 > SEGMENT_MESSAGE_LIMIT;
    const willExceedBytes = Buffer.byteLength(JSON.stringify(decompressed), 'utf8') +
                            Buffer.byteLength(JSON.stringify(message), 'utf8') > SEGMENT_BYTE_THRESHOLD;

    if (willExceedCount || willExceedBytes) {
      // Create new segment
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
        { _id: conversationId, 'messageSegments._id': lastSegment._id },
        {
          $push: { messageSegments: segmentObj },
          $inc: { totalMessages: 1 },
          $set: lastMessageFields,
        },
        { new: true }
      ).exec();

      if (updated) return updated;
      continue;
    }

    // --- Append to last segment ---
    decompressed.push({ ...message, _id: new mongoose.Types.ObjectId() });
    const recompressed = await compressMessages(decompressed);

    const updatedSegmentFields = {
      'messageSegments.$.data': recompressed,
      'messageSegments.$.messageCount': decompressed.length,
      'messageSegments.$.lastMessageAt': message.createdAt,
      'messageSegments.$.checksum': checksumBuffer(recompressed),
    };

    const query = {
      _id: conversationId,
      'messageSegments.messageCount': lastSegment.messageCount,
      'messageSegments.lastMessageAt': lastSegment.lastMessageAt,
      'messageSegments.checksum': lastSegment.checksum,
    };

    const setObject = { ...updatedSegmentFields, ...lastMessageFields };

    const updated = await Conversation.findOneAndUpdate(
      query,
      { $set: setObject, $inc: { totalMessages: 1 } },
      { new: true }
    ).exec();

    if (updated) return updated;
  }

  throw new Error('Failed to append message after retries');
};

/* -------------------------
   Get paginated messages
------------------------- */
conversationSchema.statics.getMessagesPaginated = async function (conversationId, options = {}) {
  const limit = Math.min(options.limit || 50, 500);
  const before = options.before ? new Date(options.before) : null;

  const convo = await this.findById(conversationId).select('messageSegments').lean();
  if (!convo) throw new Error('Conversation not found');

  const results = [];
  const segments = convo.messageSegments || [];

  for (let i = segments.length - 1; i >= 0 && results.length < limit; i--) {
    const seg = segments[i];
    const messages = await decompressMessages(seg.data);
    const filtered = before ? messages.filter(m => new Date(m.createdAt) < before) : messages;

    for (let j = filtered.length - 1; j >= 0 && results.length < limit; j--) {
      results.push(filtered[j]);
    }
  }

  results.reverse();
  return results;
};

/* -------------------------
   Indexes & Export
------------------------- */
conversationSchema.index({ credit: 1 });
conversationSchema.index({ participants: 1 });
conversationSchema.index({ updatedAt: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);
module.exports = Conversation;
