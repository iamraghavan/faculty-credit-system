const request = require('supertest');
const app = require('../../server'); // Express app
const jwt = require('jsonwebtoken');

let memoryDB = {
  Users: [],
  Credits: [],
  CreditTitles: []
};

jest.mock('../../utils/firebase', () => ({
  admin: {},
  db: {}
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: {
      from: jest.fn().mockReturnValue({})
    },
    PutCommand: class {
      constructor(params) { this.params = params; }
    },
    GetCommand: class {
      constructor(params) { this.params = params; }
    },
    ScanCommand: class {
      constructor(params) { this.params = params; }
    },
    UpdateCommand: class {
      constructor(params) { this.params = params; }
    },
    DeleteCommand: class {
      constructor(params) { this.params = params; }
    }
  };
});

jest.mock('../../config/db', () => ({
  connectDB: jest.fn(),
  getDynamoClient: jest.fn().mockReturnValue({
    send: jest.fn(async (command) => {
      const { TableName } = command.params;
      
      // Map tables to our in memory arrays
      let collection;
      if (TableName === process.env.DYNAMO_DB_USERS) collection = memoryDB.Users;
      else if (TableName === process.env.DYNAMO_DB_CREDITS) collection = memoryDB.Credits;
      else if (TableName === process.env.DYNAMO_DB_CREDIT_TITLES) collection = memoryDB.CreditTitles;
      else collection = memoryDB.Credits; // fallback
      
      if (command.constructor.name === 'PutCommand') {
        collection.push(command.params.Item);
        return {};
      }
      if (command.constructor.name === 'ScanCommand') {
        return { Items: collection };
      }
      if (command.constructor.name === 'GetCommand') {
        const id = command.params.Key._id;
        const item = collection.find(i => i._id === id);
        return { Item: item };
      }
      if (command.constructor.name === 'DeleteCommand') {
        const id = command.params.Key._id;
        const idx = collection.findIndex(i => i._id === id);
        if (idx !== -1) collection.splice(idx, 1);
        return {};
      }
      if (command.constructor.name === 'UpdateCommand') {
        const id = command.params.Key._id;
        const idx = collection.findIndex(i => i._id === id);
        if (idx !== -1) {
          const updateVals = command.params.ExpressionAttributeValues;
          Object.keys(updateVals).forEach(key => {
            const actualKey = key.replace(':', '');
            collection[idx][actualKey] = updateVals[key];
          });
        }
        return {};
      }
      return {};
    })
  })
}));

// Mock socket.io and file upload
jest.mock('../../socket', () => ({ emit: jest.fn() }));
jest.mock('../../utils/fileUpload', () => ({
  handleFileUpload: jest.fn().mockResolvedValue({ proofUrl: 'http://test-url.com/proof.pdf', proofMeta: {} })
}));

describe('Integration: Credit Lifecycle', () => {
  let facultyToken;
  let adminToken;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.DYNAMO_DB_USERS = 'users-table';
    process.env.DYNAMO_DB_CREDITS = 'credits-table';
    
    facultyToken = jwt.sign({ id: 'faculty123', role: 'faculty' }, process.env.JWT_SECRET);
    adminToken = jwt.sign({ id: 'admin123', role: 'admin' }, process.env.JWT_SECRET);
    
    memoryDB.Users.push({ _id: 'faculty123', role: 'faculty', name: 'John Doe' });
    memoryDB.Users.push({ _id: 'admin123', role: 'admin', name: 'Super Admin' });
  });

  afterEach(() => {
    memoryDB.Credits = []; // reset credits after each test
  });

  it('should submit a positive credit (Faculty)', async () => {
    const res = await request(app)
      .post('/api/v1/credits/submit')
      .set('Authorization', `Bearer ${facultyToken}`)
      .send({
        title: 'Published Paper',
        points: 10,
        academicYear: '2024-2025'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    
    // Verify it is in DB as 'pending'
    const dbCredit = memoryDB.Credits[0];
    expect(dbCredit).toBeDefined();
    expect(dbCredit.status).toBe('pending');
    expect(dbCredit.type).toBe('positive');
  });

  it('should reject credit submission if missing required fields', async () => {
    const res = await request(app)
      .post('/api/v1/credits/submit')
      .set('Authorization', `Bearer ${facultyToken}`)
      .send({
        title: 'Published Paper' // missing points and academic year
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
    expect(memoryDB.Credits.length).toBe(0);
  });
});
