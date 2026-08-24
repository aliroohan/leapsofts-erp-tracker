export const IPC = {
  login: 'tracker:login',
  logout: 'tracker:logout',
  getState: 'tracker:getState',
  checkIn: 'tracker:checkIn',
  checkOut: 'tracker:checkOut',
  startBreak: 'tracker:startBreak',
  endBreak: 'tracker:endBreak',
  stateChanged: 'tracker:stateChanged'
} as const
