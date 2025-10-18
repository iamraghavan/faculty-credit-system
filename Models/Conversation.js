// models/Conversation.js
const mongoose = require('mongoose');
const zlib = require('zlib');
const { promisify } = require('util');
const crypto = require('crypto');

const gzip = promisify(zlib.gzip);
const ungzip = promisify(zlib.unzip || zlib.gunzip); // prefer unzip if available, fallback to gunzip
const { Schema } = mongoose;

/*
Message shape (stored inside compressed segments)
{
  _id: ObjectId,
  sender: ObjectId,
  senderSnapshot: { name, facultyID, college, department },
  type: 'positive'|'negative'|'system',
  content: { text: String, meta: Object },
  createdAt: Date
}
*/

const SEGMENT_MESSAGE_LIMIT = 100;         // max messages per compressed segment
const SEGMENT_BYTE_THRESHOLD = 64 * 1024;  // 64KB target per segment

const messageSegmentSchema = new Schema(
  {
    data: { type: Buffer, required: true },       // gzip Buffer
    messageCount: { type: Number, required: true },
    firstMessageAt: { type: Date, required: true },
    lastMessageAt: { type: Date, required: true },
    checksum: { type: String, required: true },
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

    messageSegments: { type: [messageSegmentSchema], default: [] },

    // lastMessage as an embedded sub-document (not a String) — ensures proper casting
    lastMessage: {
      text: { type: String },
      sender: { type: Schema.Types.ObjectId, ref: 'User' },
      createdAt: { type: Date },
      type: { type: String },
    },

    totalMessages: { type: Number, default: 0 },
    unreadCounts: { type: Map, of: Number, default: {} },
  },
  { timestamps: true }
);

/* -------------------------
   Helpers: compress / decompress
   ------------------------- */
async function compressMessages(messagesArray) {
  const json = JSON.stringify(messagesArray);
  const buf = Buffer.from(json, 'utf8');
  return await gzip(buf);
}

async function decompressMessages(buffer) {
  // NOTE: zlib.unzip/gunzip both supported; use the chosen promisified function
  const decompressed = await ungzip(buffer);
  return JSON.parse(decompressed.toString('utf8'));
}

function checksumBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/* -------------------------
   appendMessage static
   ------------------------- */
conversationSchema.statics.appendMessage = async function (conversationId, message) {
  const Conversation = this;
  const MAX_RETRIES = 5;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // snapshot
    const convo = await Conversation.findById(conversationId)
      .select('messageSegments totalMessages lastMessage participants')
      .exec();
    if (!convo) throw new Error('Conversation not found');

    const segments = convo.messageSegments || [];
    const lastSegment = segments.length ? segments[segments.length - 1] : null;

    // prepare lastMessage subfields
    const lastMessageFields = {
      'lastMessage.text': message.content && message.content.text ? message.content.text : '',
      'lastMessage.sender': message.sender,
      'lastMessage.createdAt': message.createdAt,
      'lastMessage.type': message.type,
    };

    // If no segment exists -> create first segment
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
      continue; // retry if race
    }

    // Decompress and decide whether to append or create new segment
    const decompressed = await decompressMessages(lastSegment.data);
    const willExceedMessageCount = decompressed.length + 1 > SEGMENT_MESSAGE_LIMIT;
    const candidateJsonSize =
      Buffer.byteLength(JSON.stringify(decompressed), 'utf8') +
      Buffer.byteLength(JSON.stringify(message), 'utf8');
    const willExceedByteLimit = candidateJsonSize > SEGMENT_BYTE_THRESHOLD;

    if (willExceedMessageCount || willExceedByteLimit) {
      // create new segment
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
      continue; // retry
    }

    // append into existing last segment
    decompressed.push({ ...message, _id: new mongoose.Types.ObjectId() });
    const recompressed = await compressMessages(decompressed);
    const updatedSegmentFields = {
      'messageSegments.$.data': recompressed,
      'messageSegments.$.messageCount': decompressed.length,
      'messageSegments.$.lastMessageAt': message.createdAt,
      'messageSegments.$.checksum': checksumBuffer(recompressed),
    };

    // atomic match for last-segment snapshot
    const query = {
      _id: conversationId,
      'messageSegments.messageCount': lastSegment.messageCount,
      'messageSegments.lastMessageAt': lastSegment.lastMessageAt,
      'messageSegments.checksum': lastSegment.checksum,
    };

    // combine segment updates and lastMessage updates into a single $set
    const setObject = {
      ...updatedSegmentFields,
      ...lastMessageFields,
    };

    const updated = await Conversation.findOneAndUpdate(
      query,
      {
        $set: setObject,
        $inc: { totalMessages: 1 },
      },
      { new: true }
    ).exec();

    if (updated) return updated;

    // else loop and retry
  }

  throw new Error('Failed to append message after retries');
};

/* -------------------------
   getMessagesPaginated static
   ------------------------- */
conversationSchema.statics.getMessagesPaginated = async function (conversationId, options = {}) {
  const Conversation = this;
  const limit = Math.min(options.limit || 50, 500);
  const before = options.before ? new Date(options.before) : null;

  const convo = await Conversation.findById(conversationId).select('messageSegments').lean();
  if (!convo) throw new Error('Conversation not found');

  const segments = convo.messageSegments || [];
  const results = [];

  // iterate from newest segments backwards until we collect `limit` messages
  for (let i = segments.length - 1; i >= 0 && results.length < limit; i--) {
    const seg = segments[i];
    const messages = await decompressMessages(seg.data); // chronological within segment
    const filtered = before ? messages.filter(m => new Date(m.createdAt) < before) : messages;
    for (let j = filtered.length - 1; j >= 0 && results.length < limit; j--) {
      results.push(filtered[j]);
    }
  }

  // convert newest->oldest into chronological order
  results.reverse();
  return results;
};

/* -------------------------
   Indexes & model export
   ------------------------- */
conversationSchema.index({ credit: 1 });
conversationSchema.index({ participants: 1 });
conversationSchema.index({ updatedAt: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);
module.exports = Conversation;
