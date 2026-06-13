const request = require('supertest');
const app = require('../../server'); // Express app
const jwt = require('jsonwebtoken');

// We will mock the DynamoDB client entirely to act as an in-memory database
let memoryDB = {
  Users: []
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
      
      // Handle Users Table
      if (command.constructor.name === 'PutCommand') {
        memoryDB.Users.push(command.params.Item);
        return {};
      }
      if (command.constructor.name === 'ScanCommand') {
        return { Items: memoryDB.Users };
      }
      if (command.constructor.name === 'GetCommand') {
        const id = command.params.Key._id;
        const user = memoryDB.Users.find(u => u._id === id);
        return { Item: user };
      }
      if (command.constructor.name === 'DeleteCommand') {
        const id = command.params.Key._id;
        memoryDB.Users = memoryDB.Users.filter(u => u._id !== id);
        return {};
      }
      if (command.constructor.name === 'UpdateCommand') {
        const id = command.params.Key._id;
        const idx = memoryDB.Users.findIndex(u => u._id === id);
        if (idx !== -1) {
          // Simplistic update for mocking purposes
          const updateVals = command.params.ExpressionAttributeValues;
          Object.keys(updateVals).forEach(key => {
            const actualKey = key.replace(':', '');
            memoryDB.Users[idx][actualKey] = updateVals[key];
          });
        }
        return {};
      }
      return {};
    })
  })
}));

describe('Integration: User Lifecycle', () => {
  let adminToken;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
    // Create an admin user to get auth token
    adminToken = jwt.sign({ id: 'admin123', role: 'admin' }, process.env.JWT_SECRET);
    
    // Seed admin user in memory DB
    memoryDB.Users.push({
      _id: 'admin123',
      role: 'admin',
      name: 'Super Admin',
      email: 'admin@fcs.com'
    });
  });

  afterEach(() => {
    // Reset DB (keeping admin)
    memoryDB.Users = memoryDB.Users.filter(u => u._id === 'admin123');
  });

  it('should create a new user (faculty)', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'John Doe',
        email: 'john@faculty.com',
        role: 'faculty',
        department: 'Computer Science',
        college: 'Engineering'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('john@faculty.com');
    
    // Verify it was actually saved in our memory DB mock
    const dbUser = memoryDB.Users.find(u => u.email === 'john@faculty.com');
    expect(dbUser).toBeDefined();
    expect(dbUser.role).toBe('faculty');
  });

  it('should retrieve a list of users', async () => {
    memoryDB.Users.push({ _id: 'user1', name: 'Alice', role: 'faculty' });
    
    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`);
      
    expect(res.statusCode).toEqual(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2); // Admin + Alice
  });

  it('should update user information', async () => {
    memoryDB.Users.push({ _id: 'user2', name: 'Bob', role: 'faculty', department: 'CS' });

    const res = await request(app)
      .put('/api/v1/users/user2')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        department: 'IT'
      });

    expect(res.statusCode).toEqual(200);
    
    // Verify update propagated
    const updatedUser = memoryDB.Users.find(u => u._id === 'user2');
    expect(updatedUser.department).toBe('IT');
  });

  it('should delete a user', async () => {
    memoryDB.Users.push({ _id: 'user3', name: 'Charlie', role: 'faculty' });

    const res = await request(app)
      .delete('/api/v1/users/user3')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    
    // Verify deletion
    const deletedUser = memoryDB.Users.find(u => u._id === 'user3');
    expect(deletedUser).toBeUndefined();
  });
});
