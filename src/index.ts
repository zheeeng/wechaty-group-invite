import { WechatyBuilder, ScanStatus } from 'wechaty'
import * as qrcode from 'qrcode-terminal'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const logs: Array<{ type: 'log' | 'error', text: string  }> = []

const debug = {
  log: (text: string) => {
    console.log(text)
    logs.push({ type: 'log', text })
  },
  error: (text: string) => {
    console.error(text)
    logs.push({ type: 'error', text })
  },
}

const whoAmI = process.env['WB_WHO_AM_I']
const targetGroupName = process.env['WB_TARGET_GROUP_NAME']
const actionTimeout = 3000

if (!whoAmI) {
  throw new Error('WB_WHO_AM_I is not set')
}

if (!targetGroupName) {
  throw new Error('WB_TARGET_GROUP_NAME is not set')
}

const wechaty = WechatyBuilder.build()

wechaty
  .on('scan', (code, status) => {
    if (status === ScanStatus.Waiting) {
      debug.log(`扫描二维码登录：${code}`)
      qrcode.generate(code, { small: true })
    }
  })
  .on('login', (user) => {
    debug.log(`用户 ${user.name()} 登录`)
  })
  .on('logout', (user) => {
    debug.log(`用户 ${user.name()} 登出`)
  })
  .on('error', error => {
    debug.error(`遇到错误：${String(error)}`)
  })
  .on('message', async (message) => {
    const messageType = message.type()
    const name = message.talker().name()

    debug.log(`消息类型：${messageType}`)
    debug.log(`消息发送者备注名：${name}`)

    if (messageType !== wechaty.Message.Type.Text) {
      return
    }

    const text = message.text()
    debug.log(`收到消息：${text}`)

    if (text !== '进群' && text !== '入群') {
      return
    }

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

process.stdin.on('data', async (buffer) => {
  const line = buffer.toString().trim()

  if (line === 'logs') {
    logs.forEach(log => {
      console[log.type](log.text)
    })
  } else if (line === 'logout') {
    await wechaty.logout()
    logs.splice(0, logs.length)
  } else if (line === 'exit') {
    await exit()
  }
})

process.on('SIGINT', exit)
