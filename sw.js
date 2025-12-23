/**
 * Service Worker - PDV Mobile
 * Versão: v2 (Atualização Obrigatória)
 */

const CACHE_NAME = 'pdv-mobile-v2'; // Mudamos para v2 para forçar atualização
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './logo.png',
  'https://fonts.googleapis.com/icon?family=Material+Icons+Round',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://unpkg.com/html5-qrcode',
  'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js'
];

// Instalação: Cache dos arquivos estáticos
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Força o SW a ativar imediatamente
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache v2 aberto');
        return cache.addAll(urlsToCache);
      })
  );
});

// Ativação: Limpa caches antigos (v1, etc)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Apagando cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim(); // Assume o controle da página imediatamente
});

// Interceptação: Cache First, depois Network (Melhor performance)
self.addEventListener('fetch', (event) => {
  // Não cacheia chamadas para a API do Google Script (sempre online ou tratado no script.js)
  if (event.request.url.includes('script.google.com')) {
      return; 
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Se achou no cache, retorna
        if (response) {
          return response;
        }
        // Se não, busca na rede
        return fetch(event.request).then(
          (networkResponse) => {
            // Verifica se a resposta é válida antes de cachear
            if(!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            // Clona a resposta para salvar no cache novo dinamicamente
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });
            return networkResponse;
          }
        );
      })
  );
});
