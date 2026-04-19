import clickSound from '../assets/click.mp3'

// -4dB ≈ 10^(-4/20) ≈ 0.63
const VOLUME = 0.63
let audioCtx: AudioContext | null = null
let audioBuffer: AudioBuffer | null = null
let loading = false

async function initAudio(): Promise<void> {
  if (audioBuffer || loading) return
  loading = true
  try {
    audioCtx = new AudioContext()
    const response = await fetch(clickSound)
    const arrayBuffer = await response.arrayBuffer()
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
  } catch {
    // ignore — audio may not be available
  } finally {
    loading = false
  }
}

export function playNotificationSound(): void {
  if (!audioCtx || !audioBuffer) {
    initAudio().then(() => playNotificationSound())
    return
  }
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }
    const source = audioCtx.createBufferSource()
    source.buffer = audioBuffer
    const gain = audioCtx.createGain()
    gain.gain.value = VOLUME
    source.connect(gain)
    gain.connect(audioCtx.destination)
    source.start(0)
  } catch {
    // ignore
  }
}
