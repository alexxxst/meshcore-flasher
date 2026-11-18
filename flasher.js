import './lib/beer.min.js?v=844bfa7eda';
import { createApp } from './lib/vue.min.js?v=844bfa7eda';
import { createSetup } from './js/app.js?v=844bfa7eda';
import { loadCatalog } from './js/catalog.js?v=844bfa7eda';

try {
  const config = await loadCatalog();

  createApp({
    setup: createSetup(config),
  }).mount('#app');
}
catch (e) {
  console.error(e);

  const app = document.getElementById('app');
  app.removeAttribute('v-cloak');

  const box = document.createElement('div');
  box.className = 'load-error';

  const title = document.createElement('h5');
  title.textContent = 'Не удалось загрузить каталог прошивок';

  const message = document.createElement('p');
  message.textContent = `Проверьте соединение и обновите страницу. Детали: ${e.message}`;

  const link = document.createElement('a');
  link.href = 'https://meshcore.spb.ru/wiki/experiment';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Открыть страницу прошивок на wiki';

  box.append(title, message, link);
  app.replaceChildren(box);
}
