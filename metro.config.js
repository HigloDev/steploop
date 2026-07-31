const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Windows 上 Node 默认将 'localhost' 解析为 IPv6 (::1)，导致 adb reverse (IPv4 127.0.0.1)
// 无法转发到 Metro。强制监听所有 IPv4 接口，让真机调试走 adb reverse 通道。
config.server.host = '0.0.0.0';

module.exports = config;
