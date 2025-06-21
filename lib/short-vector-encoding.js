module.exports = class ShortVectorEncoding {
  static encodeLength (length) {
    const bytes = []
    let remaining = length

    while (true) {
      let elem = remaining & 0x7f

      remaining >>= 7

      if (remaining === 0 || !remaining) {
        bytes.push(elem)

        break
      }

      elem |= 0x80

      bytes.push(elem)
    }

    return bytes
  }

  static decodeLength (bytes) {
    let length = 0
    let size = 0

    while (true) {
      const elem = bytes.shift()

      length |= (elem & 0x7f) << (size * 7)
      size += 1

      if (elem & 0x80 === 0) {
        break
      }
    }

    return length
  }
}
