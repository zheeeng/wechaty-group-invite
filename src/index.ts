import { WechatyBuilder, ScanStatus } from 'wechaty'
import Koa from 'koa'
import * as qrcodeTerminal from 'qrcode-terminal'
import QrcodeSVG from 'qrcode-svg'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const state = {
  svgQRCode: '',
  logged: '',
  ctxSet: new Set<Koa.Context>(),
  chats: [] as Array<{ text: string, time: number }>,
  logs: [] as Array<{ type: 'log' | 'error', text: string, time: number }>,
  serverLogs: [] as Array<{ type: 'log' | 'error', text: string, time: number }>,
}

const debug = {
  chat: (text: string) => {
    console.log(text)
    state.chats.push({ text, time: Date.now()})
  },
  log: (text: string) => {
    console.log(text)
    state.logs.push({ type: 'log', text, time: Date.now()})

    debug.serverBroadCast('log', text)
  },
  error: (text: string) => {
    console.error(text)
    state.logs.push({ type: 'error', text, time: Date.now()})

    debug.serverBroadCast('log', `遇到错误：${text}`)
  },
  serverLog: (text: string) => {
    console.log(text)
    state.serverLogs.push({ type: 'log', text, time: Date.now()})
  },
  serverError: (text: string) => {
    console.error(text)
    state.serverLogs.push({ type: 'error', text, time: Date.now()})
  },
  serverBroadCast: (type: 'qrcode' | 'login' | 'logout' | 'log', message: string) => {
    if (disableServer) {
      return
    }

    state.ctxSet.forEach(ctx => {
      ctx.res.write(`data: ${JSON.stringify({ type, message })}\n\n`)
    })
  }
}

const whoAmI = process.env['WB_WHO_AM_I'] || '进群小助手'
const targetGroupName = process.env['WB_TARGET_GROUP_NAME']
const actionTimeout = 3000
const disableCLI = !!process.env['WB_DISABLE_CLI']
const disableServer = !!process.env['WB_ENABLE_SERVER']
const appPort = process.env['WB_APP_PORT'] || 3000

if (!targetGroupName) {
  throw new Error('WB_TARGET_GROUP_NAME is not set')
}

const wechaty = WechatyBuilder.build()

wechaty
  .on('scan', (code, status) => {
    if (status === ScanStatus.Waiting) {
      debug.log(`扫描二维码登录：${code}`)

      if (!disableServer) {
        state.svgQRCode = new QrcodeSVG({
          content: code,
          width: 300,
          height: 300,
        }).svg()

        debug.serverBroadCast('qrcode', state.svgQRCode)
      }

      if (!disableCLI) {
        qrcodeTerminal.generate(code, { small: true })
      }
    }
  })
  .on('login', (user) => {
    const name = user.name()
    state.logged = name
    debug.log(`用户 ${name} 登录`)

    debug.serverBroadCast('login', name)
  })
  .on('logout', (user) => {
    const name = user.name()
    state.logged = ''
    state.logs.splice(0, state.logs.length)
    debug.log(`用户 ${name} 登出`)

    debug.serverBroadCast('logout', name)
  })
  .on('error', error => {
    debug.error(`遇到错误：${String(error)}`)
  })
  .on('message', async (message) => {
    const messageType = message.type()
    const name = message.talker().name()

    debug.chat(`消息类型：${messageType}`)
    debug.chat(`消息发送者备注名：${name}`)

    if (messageType !== wechaty.Message.Type.Text) {
      return
    }

    const text = message.text()
    debug.chat(`收到消息：${text}`)

    if (text !== '进群' && text !== '入群') {
      return
    }

    debug.log(`收到进群请求：${name}`)

    const targetGroup = await wechaty.Room.find(targetGroupName)

    if (targetGroup) {
      await targetGroup.add(message.talker())
      debug.log(`已邀请 ${name} 加入群聊 ${targetGroupName}`)
      await targetGroup.say(`欢迎 ${name} 加入群聊！`)
    } else {
      debug.log(`未找到指定群聊 ${targetGroupName}`)
    }
  })
  .on('friendship', async (friendship) => {
    const contactName = friendship.contact().name()
    debug.log(`接收到好友请求：${contactName}`)

    await delay(actionTimeout)
    await friendship.accept()
    debug.log(`已接受好友请求：${contactName}`)

    await delay(actionTimeout)
    await friendship.contact().say(`你好，我是${whoAmI}，回复“进群”我将邀请你加入"${targetGroupName}"。`)
    debug.log(`已向好友 ${contactName} 发送欢迎消息`)
  })

void wechaty.start()

async function exit () {
  debug.log('Shutting down...')
  await wechaty.stop()
  process.exit()
}

async function logout () {
  await wechaty.logout()
}

function formatTimestamp(timestamp: number, timeZone: string, locale = 'en-US') {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: timeZone,
    hour12: false
  }).format(new Date(timestamp))
}

function getFormattedLog () {
  return state.logs.map(log => `${formatTimestamp(log.time, 'Asia/Shanghai')} [debug:${log.type}] ${log.text}`).join('\n')
}
function getFormattedChat () {
  return state.chats.map(log => `${formatTimestamp(log.time, 'Asia/Shanghai')} [chat:] ${log.text}`).join('\n')
}
function getFormattedServerLog () {
  return state.serverLogs.map(log => `${formatTimestamp(log.time, 'Asia/Shanghai')} [server:${log.type}] ${log.text}`).join('\n')
}

process.on('SIGINT', exit)

if (!disableCLI) {
  process.stdin.on('data', async (buffer) => {
    const line = buffer.toString().trim()
  
    if (line === 'logs') {
      console.log(getFormattedChat())
      console.log(getFormattedLog())
      console.log(getFormattedServerLog())
    } else if (line === 'logout') {
      await logout()
    } else if (line === 'exit') {
      await exit()
    }
  })
}

if (!disableServer) {
  const app = new Koa()

  app.use(async (ctx) => {
    debug.serverLog(`请求：${ctx.method} ${ctx.path}`)

    if (ctx.method === 'GET') {
      if (ctx.path === '/qrcode.svg') {
        ctx.set('Content-Type', 'image/svg+xml')
        ctx.body = state.svgQRCode

        return
      } else if (ctx.path === '/logout') {
        await logout()
        ctx.body = '已登出'

        return
      } else if (ctx.path === '/events') {
        ctx.set('Content-Type', 'text/event-stream')
        ctx.set('Cache-Control', 'no-cache')
        ctx.set('Connection', 'keep-alive')
        ctx.status = 200
        ctx.respond = false
        ctx.req.socket.setNoDelay(true)
        state.ctxSet.add(ctx)
        debug.serverLog(`新的 EventSource 连接：${ctx.ip}`)

        ctx.req.on('close', () => {
          state.ctxSet.delete(ctx)
          debug.serverLog(`EventSource 连接断开：${ctx.ip}`)
        })
      } else {
        ctx.body = `
          <h3>你好<b id="logged-username">${state.logged}</b>!</h3>
          <h3>欢迎使用本服务，我是<b>${whoAmI}</b></h3>
          <div id="login-box" style="display: ${state.logged ? 'none' : 'block'};">
            <h2>扫码登录</h2>
            <img id="qrcode-image" src="/qrcode.svg" />
          </div>
          <a id="logout-form" style="display: ${state.logged ? 'block' : 'none'};" href="/logout" target="_blank">登出</a>
          <div id="logs">
            <h2>日志</h2>
          </div>
          <script>
            const eventSource = new EventSource('/events');
            eventSource.onmessage = (event) => {
              const { type, message  } = JSON.parse(event.data)
              if (type === 'qrcode') {
                document.getElementById('qrcode-image').src = '/qrcode.svg?${Date.now()}'
              } else if (type === 'login') {
                document.getElementById('logged-username').innerText = message
                document.getElementById('login-box').style.display = 'none'
                document.getElementById('logout-form').style.display = 'block'
              } else if (type === 'logout') {
                document.getElementById('logged-username').innerText = ''
                document.getElementById('login-box').style.display = 'block'
                document.getElementById('logout-form').style.display = 'none'
              } else if (type === 'log') {
                document.getElementById('logs').appendChild(document.createTextNode(message + '\\n'))
              }
            };
          </script>
        `

        return
      }
    }
  })

  app.listen(appPort, () => {
    debug.log(`服务运行在 ${appPort} 端口`)
  })
}