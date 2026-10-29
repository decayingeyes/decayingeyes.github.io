/**
 * Backend URL per environment. Fill apiUrl with the Apps Script web app /exec URL.
 * Switch env with ?env=test or ?env=prod (remembered on this device).
 */
window.HH_CONFIG = {
  defaultEnv: 'test', // change to 'prod' when the event goes live
  apiMajor: 0, // must match the MAJOR of the backend apiVersion
  envs: {
    test: { apiUrl: 'https://script.google.com/macros/s/AKfycbxP60LR-t69_7eNmoARjXN8PN1Fudp6t3GT3W9mmJL-HvANvuJ5CVYR85H2E75pcSau/exec' },
    prod: { apiUrl: '' },
  },
};
