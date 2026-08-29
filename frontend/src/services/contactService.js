import api from '../utils/api'

export const contactService = {
  /**
   * Submit the public Contact form. No login required.
   * @param {{name: string, email: string, message: string}} payload
   */
  async submit(payload) {
    const res = await api.post('/api/v1/contact/', payload)
    return res.data
  }
}
