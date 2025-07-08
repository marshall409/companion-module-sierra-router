
import { InstanceBase, Regex, runEntrypoint, TCPHelper } from '@companion-module/base'

class SierraAspenRouterInstance extends InstanceBase {
  constructor(internal) {
    super(internal)
    this.socket = null
    this.updateMode = 2 // U2: auto update w/ response
    this.routingStatus = {} // { "output": { level1: input, level2: input, ... } }
  }

  async init(config) {
    this.config = config
    this.updateStatus('connecting')

    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }

    this.socket = new TCPHelper(this.config.host, this.config.port)
    this.socket.on('connect', () => {
      this.updateStatus('ok')
      this.sendCommand(`**U${this.updateMode}!!`)
      this.startPolling()
    })

    this.socket.on('data', (data) => {
      const response = data.toString().trim()
      this.log('debug', `Response: ${response}`)

      const xMatch = response.match(/\*\* X(\d+),(\d+),(\d+) !!/)
      if (xMatch) {
        const output = xMatch[1]
        const input = parseInt(xMatch[2])
        const level = parseInt(xMatch[3])
        if (!this.routingStatus[output]) this.routingStatus[output] = {}
        this.routingStatus[output][`level${level}`] = input
        this.checkFeedbacks('routing_match')
        return
      }

      const yMatch = response.match(/\*\* Y(\d+),(\d+) !!/)
      if (yMatch) {
        const output = yMatch[1]
        const input = parseInt(yMatch[2])
        this.routingStatus[output] = {
          level1: input,
          level2: input,
          level3: input,
        }
        this.checkFeedbacks('routing_match')
        return
      }

      if (response.includes('ERROR')) {
        this.updateStatus('error', response)
      }
    })

    this.socket.on('error', err => {
      this.updateStatus('error', err.message)
    })

    this.socket.on('end', () => {
      this.updateStatus('disconnected')
    })
  }

  startPolling() {
    if (this.pollingInterval) clearInterval(this.pollingInterval)
    this.pollingInterval = setInterval(() => {
      this.sendCommand('**S!!')
    }, 10000)
  }

  async configUpdated(config) {
    this.config = config
    this.init(config)
  }

  async destroy() {
    if (this.socket) this.socket.destroy()
    if (this.pollingInterval) clearInterval(this.pollingInterval)
  }

  sendCommand(cmd) {
    if (this.socket && this.socket.isConnected) {
      this.log('debug', `Sending: ${cmd}`)
      this.socket.send(cmd)
    } else {
      this.log('warn', 'Socket not connected')
    }
  }

  getConfigFields() {
    return [
      {
        type: 'textinput',
        id: 'host',
        label: 'Router IP Address',
        default: '192.168.0.100',
        width: 6,
      },
      {
        type: 'textinput',
        id: 'port',
        label: 'TCP Port',
        default: '23',
        width: 3,
        regex: Regex.PORT,
      },
    ]
  }

  getActions() {
    return {
      y_afv: {
        name: 'Connect Input to Output (AFV)',
        options: [
          {
            type: 'number',
            id: 'output',
            label: 'Output (1-72)',
            default: 1,
            min: 1,
            max: 72,
          },
          {
            type: 'number',
            id: 'input',
            label: 'Input (1-72)',
            default: 1,
            min: 1,
            max: 72,
          },
        ],
        callback: ({ options }) => {
          this.sendCommand(`**Y${options.output},${options.input}!!`)
        },
      },

      x_crosspoint: {
        name: 'Connect Crosspoint (Specify Level)',
        options: [
          {
            type: 'number',
            id: 'output',
            label: 'Output (1-72)',
            default: 1,
            min: 1,
            max: 72,
          },
          {
            type: 'number',
            id: 'input',
            label: 'Input (1-72)',
            default: 1,
            min: 1,
            max: 72,
          },
          {
            type: 'number',
            id: 'level',
            label: 'Level (1-3 or 0 for AFV)',
            default: 1,
            min: 0,
            max: 3,
          },
        ],
        callback: ({ options }) => {
          this.sendCommand(`**X${options.output},${options.input},${options.level}!!`)
        },
      },

      v_levels: {
        name: 'Connect Input(s) to Output by Level',
        options: [
          {
            type: 'number',
            id: 'output',
            label: 'Output (1-72)',
            default: 1,
            min: 1,
            max: 72,
          },
          {
            type: 'textinput',
            id: 'inputs',
            label: 'Input List (comma-separated per level, e.g., 3,4,0)',
            default: '1,1,1',
          },
        ],
        callback: ({ options }) => {
          this.sendCommand(`**V${options.output},${options.inputs}!!`)
        },
      },
    }
  }

  getFeedbacks() {
    return {
      routing_match: {
        type: 'boolean',
        name: 'Match Input to Output',
        description: 'Indicate when an input is routed to an output (optionally on a level)',
        options: [
          {
            type: 'number',
            label: 'Output',
            id: 'output',
            default: 1,
            min: 1,
            max: 72,
          },
          {
            type: 'number',
            label: 'Input',
            id: 'input',
            default: 1,
            min: 1,
            max: 72,
          },
          {
            type: 'dropdown',
            label: 'Level',
            id: 'level',
            default: 'any',
            choices: [
              { id: 'any', label: 'Any Level' },
              { id: 'level1', label: 'Level 1' },
              { id: 'level2', label: 'Level 2' },
              { id: 'level3', label: 'Level 3' },
            ],
          },
        ],
        defaultStyle: {
          color: 0x000000,
          bgcolor: 0x00ff00,
        },
        callback: (feedback) => {
          const { output, input, level } = feedback.options
          const status = this.routingStatus[output]
          if (!status) return false

          if (level === 'any') {
            return Object.values(status).includes(input)
          } else {
            return status[level] === input
          }
        },
      },
    }
  }
}

runEntrypoint(SierraAspenRouterInstance)
