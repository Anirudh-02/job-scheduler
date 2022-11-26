const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')

const PROTO_PATH = '../tasks.proto'

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    arrays: true
})

const SmsService = grpc.loadPackageDefinition(packageDefinition).SmsService

const client = new SmsService(
    '127.0.0.1:50051',
    grpc.credentials.createInsecure()
)

module.exports = client