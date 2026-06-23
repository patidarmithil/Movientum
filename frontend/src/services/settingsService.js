import api from '../utils/api';

const settingsService = {
  updateProfile: async (formData) => {
    const response = await api.patch('/api/v1/users/me', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  changePassword: async (data) => {
    const response = await api.patch('/api/v1/users/me/password', data);
    return response.data;
  },

  deleteAccount: async (data) => {
    const response = await api.delete('/api/v1/users/me', { data });
    return response.data;
  },

  importList: async (formData) => {
    const response = await api.post('/api/v1/users/import-list', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
};

export default settingsService;
