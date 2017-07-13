const assert = require('assert')
const {Emitter} = require('event-kit')
const {NetworkMessage} = require('./real-time_pb')

module.exports =
class StarOverlayNetwork {
  constructor ({id, peerPool, isHub}) {
    this.id = id
    this.peerPool = peerPool
    this.isHub = isHub
    if (this.isHub) this.spokes = new Set()
    this.emitter = new Emitter()

    peerPool.onReceive(this.receive.bind(this))
  }

  async connectTo (hubId) {
    assert(!this.isHub, 'The hub should only receive connections')
    this.hubId = hubId
    await this.peerPool.connectTo(this.hubId)

    const starConnection = new NetworkMessage.StarConnection()
    const networkMessage = new NetworkMessage()
    networkMessage.setStarConnection(starConnection)
    networkMessage.setNetworkId(this.id)

    this.peerPool.send(this.hubId, networkMessage.serializeBinary())
  }

  unicast (recipientId, message) {
    if (!(message instanceof Buffer)) {
      message = Buffer.from(message)
    }

    const starUnicast = new NetworkMessage.StarUnicast()
    starUnicast.setSenderId(this.peerPool.peerId)
    starUnicast.setRecipientId(recipientId)
    starUnicast.setBody(message)
    const networkMessage = new NetworkMessage()
    networkMessage.setStarUnicast(starUnicast)
    networkMessage.setNetworkId(this.id)
    const rawNetworkMessage = networkMessage.serializeBinary()

    if (this.isHub) {
      this.forwardUnicast(recipientId, rawNetworkMessage)
    } else {
      this.peerPool.send(this.hubId, rawNetworkMessage)
    }
  }

  broadcast (message) {
    if (!(message instanceof Buffer)) {
      message = Buffer.from(message)
    }

    const starBroadcast = new NetworkMessage.StarBroadcast()
    starBroadcast.setSenderId(this.peerPool.peerId)
    starBroadcast.setBody(message)
    const networkMessage = new NetworkMessage()
    networkMessage.setStarBroadcast(starBroadcast)
    networkMessage.setNetworkId(this.id)
    const rawNetworkMessage = networkMessage.serializeBinary()

    if (this.isHub) {
      this.forwardBroadcast(this.peerPool.peerId, rawNetworkMessage)
    } else {
      this.peerPool.send(this.hubId, rawNetworkMessage)
    }
  }

  onReceive (callback) {
    return this.emitter.on('receive', callback)
  }

  receive ({senderId, message}) {
    const networkMessage = NetworkMessage.deserializeBinary(message)
    if (networkMessage.getNetworkId() !== this.id) return

    if (networkMessage.hasStarConnection()) {
      this.receiveConnection(senderId)
    } else if (networkMessage.hasStarUnicast()) {
      this.receiveUnicast(message, networkMessage.getStarUnicast())
    } else if (networkMessage.hasStarBroadcast()) {
      this.receiveBroadcast(message, networkMessage.getStarBroadcast())
    }
  }

  receiveConnection (senderId) {
    assert(this.isHub, 'Can only receive the connections at the hub')
    this.spokes.add(senderId)
  }

  receiveUnicast (rawMessage, unicastMessage) {
    const recipientId = unicastMessage.getRecipientId()
    if (recipientId === this.peerPool.peerId) {
      this.emitter.emit('receive', {
        senderId: unicastMessage.getSenderId(),
        message: Buffer.from(unicastMessage.getBody())
      })
    } else if (this.isHub) {
      this.forwardUnicast(recipientId, rawMessage)
    } else {
      throw new Error('Received a unicast not intended for this peer')
    }
  }

  receiveBroadcast (rawMessage, broadcastMessage) {
    const senderId = broadcastMessage.getSenderId()
    if (this.isHub) this.forwardBroadcast(senderId, rawMessage)
    this.emitter.emit('receive', {
      senderId,
      message: Buffer.from(broadcastMessage.getBody())
    })
  }

  forwardUnicast (recipientId, rawMessage) {
    if (this.spokes.has(recipientId)) {
      this.peerPool.send(recipientId, rawMessage)
    }
  }

  forwardBroadcast (senderId, rawMessage) {
    this.spokes.forEach((peerId) => {
      if (peerId !== senderId) {
        this.peerPool.send(peerId, rawMessage)
      }
    })
  }
}