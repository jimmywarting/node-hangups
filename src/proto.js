var ProtoBuf = require("protobufjs")
var root = ProtoBuf.loadProtoFile(__dirname + "/schema.proto").build()

module.exports = root
