// utils/objectId.js
const { ObjectId } = require('bson');

exports.newObjectId = () => new ObjectId().toString();
