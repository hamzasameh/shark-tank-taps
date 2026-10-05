import crypto from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server } from 'socket.io'
import { createServer as createViteServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production')
const app = express()
const server = http.createServer(app)
const io = new Server(server)
const rooms = new Map()
function makeToken() {
  return crypto.randomBytes(18).toString('hex')
}

function makeCode() {
  let code
  do {
    code = String(crypto.randomInt(1000, 10000))
  } while (rooms.has(code))
  return code
}

function getSeconds(timer) {
  if (!timer.running) return timer.seconds
  timer.seconds = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000))
  if (timer.seconds === 0) {
    timer.running = false
    timer.endsAt = null
  }
  return timer.seconds
}

function getRoomView(room) {
  for (const group of room.groups) {
    if (group.role === 'seller') getSeconds(group.timer)
  }
  return {
    code: room.code,
    topic: room.topic,
    initialBalance: room.initialBalance,
    groupLimit: room.groupLimit,
    phase: room.phase,
    roundLocked: room.roundLocked,
    revealStartedAt: room.revealStartedAt,
    revealRemainingMs: room.revealStartedAt
      ? Math.max(0, 7000 - (Date.now() - room.revealStartedAt))
      : 0,
    groups: room.groups.map((group) => ({
      id: group.id,
      name: group.name,
      role: group.role,
      sellerNumber: group.sellerNumber,
      credits: group.credits,
      question: group.question,
      idea: group.idea,
      timer: group.role === 'seller' ? { seconds: group.timer.seconds, running: group.timer.running, started: group.timer.started } : null,
      dealLocked: group.dealLocked,
      dealAmount: group.dealLocked ? group.dealAmount : null,
    })),
  }
}

function sendRoom(room) {
  io.to(room.code).emit('room:state', getRoomView(room))
}

function reply(socket, callback, data) {
  if (typeof callback === 'function') callback(data)
}

function getHostRoom(socket) {
  const room = rooms.get(socket.data.roomCode)
  return room && socket.data.role === 'teacher' && socket.data.token === room.hostToken ? room : null
}

function getMember(socket) {
  const room = rooms.get(socket.data.roomCode)
  const group = room?.groups.find((entry) => entry.id === socket.data.groupId)
  return room && group && group.token === socket.data.token ? { room, group } : null
}

io.on('connection', (socket) => {
  socket.on('room:create', (payload, callback) => {
    const topic = String(payload?.topic || '').trim().slice(0, 64)
    const initialBalance = Number(payload?.initialBalance)
    const groupLimit = Number(payload?.groupLimit)
    if (!topic) {
      reply(socket, callback, { ok: false, error: 'Enter the lesson topic.' })
      return
    }
    if (!Number.isSafeInteger(initialBalance) || initialBalance < 0) {
      reply(socket, callback, { ok: false, error: 'Investor balance must be a whole number of zero or more.' })
      return
    }
    if (!Number.isInteger(groupLimit) || groupLimit < 2 || groupLimit > 8) {
      reply(socket, callback, { ok: false, error: 'Choose between 2 and 8 players.' })
      return
    }

    const code = makeCode()
    const room = {
      code,
      topic,
      initialBalance,
      groupLimit,
      phase: 'lobby',
      roundLocked: false,
      revealStartedAt: null,
      hostToken: makeToken(),
      groups: [],
    }
    rooms.set(code, room)
    socket.join(code)
    socket.data = { roomCode: code, role: 'teacher', token: room.hostToken }
    reply(socket, callback, {
      ok: true,
      room: getRoomView(room),
      member: { role: 'teacher', token: room.hostToken },
    })
    sendRoom(room)
  })

  socket.on('room:join', (payload, callback) => {
    const code = String(payload?.code || '').trim().toUpperCase()
    const room = rooms.get(code)
    const name = String(payload?.name || '').trim().slice(0, 32)

    if (!room) return reply(socket, callback, { ok: false, error: 'That room code was not found.' })
    if (room.phase !== 'lobby') return reply(socket, callback, { ok: false, error: 'This pitch has already started.' })
    if (!name) return reply(socket, callback, { ok: false, error: 'Add your group name first.' })
    if (room.groups.length >= room.groupLimit) return reply(socket, callback, { ok: false, error: `All ${room.groupLimit} player spots are full.` })
    if (room.groups.some((group) => group.name.toLowerCase() === name.toLowerCase())) {
      return reply(socket, callback, { ok: false, error: 'That group name is already in this room.' })
    }

    const group = {
      id: crypto.randomUUID(),
      token: makeToken(),
      name,
      role: null,
      sellerNumber: null,
      credits: 0,
      question: '',
      idea: { name: '', request: 200, equity: 10 },
      timer: { seconds: 120, running: false, endsAt: null, started: false },
      dealLocked: false,
      dealAmount: null,
    }
    room.groups.push(group)
    if (room.groups.length === room.groupLimit) {
      const investorIndex = crypto.randomInt(room.groups.length)
      let sellerNumber = 1
      room.groups.forEach((player, index) => {
        if (index === investorIndex) {
          player.role = 'investor'
          player.credits = room.initialBalance
        } else {
          player.role = 'seller'
          player.sellerNumber = sellerNumber
          sellerNumber += 1
        }
      })
    }
    socket.join(code)
    socket.data = { roomCode: code, role: group.role, groupId: group.id, token: group.token }
    reply(socket, callback, {
      ok: true,
      room: getRoomView(room),
      member: { role: group.role, groupId: group.id, token: group.token },
    })
    sendRoom(room)
  })

  socket.on('room:resume', (payload, callback) => {
    const room = rooms.get(String(payload?.code || '').toUpperCase())
    if (!room) return reply(socket, callback, { ok: false, error: 'This room is no longer available.' })

    if (payload?.role === 'teacher' && payload.token === room.hostToken) {
      socket.join(room.code)
      socket.data = { roomCode: room.code, role: 'teacher', token: room.hostToken }
      return reply(socket, callback, { ok: true, room: getRoomView(room), member: { role: 'teacher', token: room.hostToken } })
    }

    const group = room.groups.find((entry) => entry.id === payload?.groupId && entry.token === payload?.token)
    if (!group) return reply(socket, callback, { ok: false, error: 'This group could not rejoin. Ask your teacher for the room code.' })
    socket.join(room.code)
    socket.data = { roomCode: room.code, role: group.role, groupId: group.id, token: group.token }
    reply(socket, callback, { ok: true, room: getRoomView(room), member: { role: group.role, groupId: group.id, token: group.token } })
  })

  socket.on('teacher:startRound', (callback) => {
    const room = getHostRoom(socket)
    if (!room) return reply(socket, callback, { ok: false, error: 'Only the teacher can start the pitch.' })
    if (room.phase !== 'lobby' || room.groups.length !== room.groupLimit || !room.groups.some((group) => group.role === 'investor')) {
      return reply(socket, callback, { ok: false, error: `Wait until all ${room.groupLimit} players have joined and received their random roles.` })
    }
    room.phase = 'pitch'
    reply(socket, callback, { ok: true })
    sendRoom(room)
  })

  socket.on('teacher:openInvestment', (callback) => {
    const room = getHostRoom(socket)
    if (!room) return reply(socket, callback, { ok: false, error: 'Only the teacher can open investments.' })
    if (room.phase !== 'pitch') return reply(socket, callback, { ok: false, error: 'The pitch is not running.' })
    const sellers = room.groups.filter((group) => group.role === 'seller')
    if (sellers.some((group) => !group.idea.name)) {
      return reply(socket, callback, { ok: false, error: 'Wait for every Seller Group to save its pitch before opening investments.' })
    }
    room.groups.forEach((group) => {
      if (group.role === 'seller' && group.timer.running) {
        group.timer.seconds = getSeconds(group.timer)
        group.timer.running = false
        group.timer.endsAt = null
      }
    })
    room.phase = 'investing'
    reply(socket, callback, { ok: true })
    sendRoom(room)
  })

  socket.on('seller:updateIdea', (payload, callback) => {
    const member = getMember(socket)
    if (!member || member.group.role !== 'seller') return reply(socket, callback, { ok: false, error: 'Only seller groups can edit a pitch.' })
    if (!['lobby', 'pitch'].includes(member.room.phase) || member.room.roundLocked) {
      return reply(socket, callback, { ok: false, error: 'Pitch details are locked for this round.' })
    }
    const name = String(payload?.name || '').trim().slice(0, 50)
    const request = Number(payload?.request)
    const equity = Number(payload?.equity)
    if (!name) return reply(socket, callback, { ok: false, error: 'Enter an idea name.' })
    if (!Number.isSafeInteger(request) || request < 1) return reply(socket, callback, { ok: false, error: 'Requested $TAPS must be a positive whole number.' })
    if (!Number.isInteger(equity) || equity < 1 || equity > 100) return reply(socket, callback, { ok: false, error: 'Equity must be between 1 and 100 percent.' })
    member.group.idea = { name, request, equity }
    reply(socket, callback, { ok: true })
    sendRoom(member.room)
  })

  socket.on('teacher:sellerTimer', (payload, callback) => {
    const room = getHostRoom(socket)
    if (!room) return reply(socket, callback, { ok: false, error: 'Only the teacher can control pitch timers.' })
    if (room.phase !== 'pitch') return reply(socket, callback, { ok: false, error: 'Pitch timers are available during the pitch round.' })
    const seller = room.groups.find((group) => group.id === payload?.sellerId && group.role === 'seller')
    if (!seller) return reply(socket, callback, { ok: false, error: 'Seller group not found.' })

    if (payload.action === 'start') {
      if (!seller.idea.name) return reply(socket, callback, { ok: false, error: 'Ask this Seller Group to save its pitch before starting the timer.' })
      if (seller.timer.seconds === 0) return reply(socket, callback, { ok: false, error: 'Reset this timer before starting it again.' })
      seller.timer.running = true
      seller.timer.started = true
      seller.timer.endsAt = Date.now() + seller.timer.seconds * 1000
    } else if (payload.action === 'pause') {
      seller.timer.seconds = getSeconds(seller.timer)
      seller.timer.running = false
      seller.timer.endsAt = null
    } else if (payload.action === 'reset') {
      seller.timer = { seconds: 120, running: false, endsAt: null, started: false }
    } else {
      return reply(socket, callback, { ok: false, error: 'Choose start, pause, or reset.' })
    }

    reply(socket, callback, { ok: true })
    sendRoom(room)
  })

  socket.on('investor:ask', (payload, callback) => {
    const member = getMember(socket)
    if (!member || member.group.role !== 'investor') return reply(socket, callback, { ok: false, error: 'Only investor groups can ask questions.' })
    if (!['pitch', 'investing'].includes(member.room.phase)) return reply(socket, callback, { ok: false, error: 'Questions are closed for this round.' })
    const question = String(payload?.question || '').trim().slice(0, 180)
    if (!question) return reply(socket, callback, { ok: false, error: 'Write your question first.' })
    if (member.group.question) return reply(socket, callback, { ok: false, error: 'Your group has already asked its question.' })
    member.group.question = question
    reply(socket, callback, { ok: true })
    sendRoom(member.room)
  })

  socket.on('teacher:grantCredits', (payload, callback) => {
    const room = getHostRoom(socket)
    if (!room) return reply(socket, callback, { ok: false, error: 'Only the teacher can grant $TAPS.' })
    const investor = room.groups.find((group) => group.role === 'investor')
    const amount = Number(payload?.amount)
    if (!investor) return reply(socket, callback, { ok: false, error: 'Investor role has not been assigned yet.' })
    if (!Number.isSafeInteger(amount) || amount < 1) return reply(socket, callback, { ok: false, error: 'Grant a positive whole number of $TAPS.' })
    investor.credits += amount
    reply(socket, callback, { ok: true })
    sendRoom(room)
  })

  socket.on('investor:confirmDeals', (payload, callback) => {
    const member = getMember(socket)
    if (!member || member.group.role !== 'investor') return reply(socket, callback, { ok: false, error: 'Only the Investor can confirm deals.' })
    if (member.room.phase !== 'investing' || member.room.roundLocked) return reply(socket, callback, { ok: false, error: 'Investment decisions are closed.' })
    const ids = Array.isArray(payload?.sellerIds) ? [...new Set(payload.sellerIds)] : []
    if (!ids.length) return reply(socket, callback, { ok: false, error: 'Select at least one Seller Group.' })
    const selected = ids.map((id) => member.room.groups.find((group) => group.id === id && group.role === 'seller'))
    if (selected.some((seller) => !seller || seller.dealLocked || !seller.idea.name)) {
      return reply(socket, callback, { ok: false, error: 'One of those Seller Groups is no longer available.' })
    }
    const total = selected.reduce((sum, seller) => sum + seller.idea.request, 0)
    if (total > member.group.credits) return reply(socket, callback, { ok: false, error: 'Your selected deals exceed your $TAPS balance.' })
    for (const seller of selected) {
      seller.dealLocked = true
      seller.dealAmount = seller.idea.request
    }
    member.group.credits -= total
    member.room.roundLocked = true
    member.room.phase = 'revealing'
    member.room.revealStartedAt = Date.now()
    const revealStartedAt = member.room.revealStartedAt
    setTimeout(() => {
      if (member.room.phase !== 'revealing' || member.room.revealStartedAt !== revealStartedAt) return
      member.room.phase = 'ended'
      sendRoom(member.room)
    }, 7000)
    reply(socket, callback, { ok: true })
    sendRoom(member.room)
  })

})

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.phase === 'pitch') {
      for (const group of room.groups) {
        if (group.role === 'seller' && group.timer.running) getSeconds(group.timer)
      }
      sendRoom(room)
    }
  }
}, 1000)

if (production) {
  const dist = path.join(root, 'dist')
  app.use(express.static(dist))
  app.use((request, response, next) => {
    response.sendFile(path.join(dist, 'index.html'), (error) => error && next(error))
  })
} else {
  const vite = await createViteServer({
    configFile: path.join(root, 'vite.config.js'),
    root,
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

const port = Number(process.env.PORT) || 5173
server.listen(port, '0.0.0.0', () => {
  console.log(`PitchDay is ready on port ${port}. Open this address on the teacher device and share it with the class.`)
})
