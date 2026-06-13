const swaggerAutogen = require('swagger-autogen')();

const doc = {
  info: {
    title: 'Faculty Credit System API',
    description: 'API documentation for the Faculty Credit System',
  },
  host: 'fcs.egspgroup.in',
  schemes: ['https'],
};

const outputFile = './swagger.json';
const endpointsFiles = ['./server.js'];

swaggerAutogen(outputFile, endpointsFiles, doc).then(() => {
    console.log("Swagger documentation generated!");
});
