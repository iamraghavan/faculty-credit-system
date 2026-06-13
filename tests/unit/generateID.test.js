const { generateFacultyID, generateApiKey } = require('../../utils/generateID');

describe('generateID Utility', () => {
  describe('generateFacultyID', () => {
    it('should generate Engineering College ID correctly', () => {
      const id = generateFacultyID('Engineering College');
      expect(id).toMatch(/^EGSP\/EC\/\d{5}$/);
    });

    it('should generate Arts and Science College ID correctly', () => {
      const id = generateFacultyID('Arts and Science College');
      expect(id).toMatch(/^EGSP\/ASC\/\d{5}$/);
    });

    it('should default to GEN for unknown colleges', () => {
      const id = generateFacultyID('Unknown Institute');
      expect(id).toMatch(/^EGSP\/GEN\/\d{5}$/);
    });

    it('should default to GEN for empty string', () => {
      const id = generateFacultyID('');
      expect(id).toMatch(/^EGSP\/GEN\/\d{5}$/);
    });
  });

  describe('generateApiKey', () => {
    it('should generate a valid API key format', () => {
      const key = generateApiKey();
      expect(key).toMatch(/^ak_[a-f0-9]{32}$/);
    });

    it('should generate unique keys', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });
  });
});
