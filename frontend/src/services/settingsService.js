import api from '../utils/api';

// Pull the server-chosen name out of Content-Disposition, else use the fallback.
const filenameFrom = (headers, fallback) => {
  const cd = headers?.['content-disposition'] || '';
  const match = /filename="?([^";]+)"?/i.exec(cd);
  return match ? match[1] : fallback;
};

const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const downloadFile = async (path, fallbackName) => {
  const response = await api.get(path, { responseType: 'blob' });
  saveBlob(response.data, filenameFrom(response.headers, fallbackName));
};

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

  exportList: () => downloadFile('/api/v1/users/me/export/list.csv', 'movientum_list.csv'),

  exportFull: () => downloadFile('/api/v1/users/me/export/full.json', 'movientum_ai_export.json'),
};

export default settingsService;
