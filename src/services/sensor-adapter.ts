import { Accelerometer, Barometer, DeviceMotion, Gyroscope } from 'expo-sensors'
import {
  AccelerometerPayload,
  BarometerPayload,
  DeviceMotionPayload,
  GyroscopePayload,
  Listener,
  SensorAdapter,
  SensorSubscription,
} from './round-coordinator'

/**
 * expo-sensors 的真实驱动实现。
 *
 * 存在的意义只是把「订阅/取消订阅」收敛到一个接口后面：
 * - 生产代码走这里；
 * - 自动化测试注入 fake adapter，就能在 Node 下复现 start/stop/unmount 交错，
 *   不需要真机、也不需要模拟整个 expo-sensors。
 */
export const expoSensorAdapter: SensorAdapter = {
  setAccelerometerInterval: (ms) => {
    Accelerometer.setUpdateInterval(ms)
  },
  setGyroscopeInterval: (ms) => {
    Gyroscope.setUpdateInterval(ms)
  },
  setDeviceMotionInterval: (ms) => {
    DeviceMotion.setUpdateInterval(ms)
  },
  setBarometerInterval: (ms) => {
    Barometer.setUpdateInterval(ms)
  },
  subscribeAccelerometer: (listener: Listener<AccelerometerPayload>): SensorSubscription =>
    Accelerometer.addListener((value) =>
      listener({
        x: Number(value?.x) || 0,
        timestamp: value.timestamp,
        y: Number(value?.y) || 0,
        z: Number(value?.z) || 0,
      }),
    ),
  subscribeGyroscope: (listener: Listener<GyroscopePayload>): SensorSubscription =>
    Gyroscope.addListener((value) =>
      listener({
        x: Number(value?.x) || 0,
        y: Number(value?.y) || 0,
        z: Number(value?.z) || 0,
      }),
    ),
  subscribeDeviceMotion: (listener: Listener<DeviceMotionPayload>): SensorSubscription =>
    DeviceMotion.addListener((value) =>
      listener({ rotation: value?.rotation ?? undefined }),
    ),
  subscribeBarometer: (listener: Listener<BarometerPayload>): SensorSubscription =>
    Barometer.addListener((value) => listener({ pressure: Number(value?.pressure), timestamp: value.timestamp })),
}
