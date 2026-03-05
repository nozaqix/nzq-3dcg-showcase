import experiments from '../experiments.json';

const grid = document.getElementById('grid')!;

for (const exp of experiments) {
  const date = new Date(exp.date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const card = document.createElement('a');
  card.className = 'card';
  card.href = `./${exp.slug}/`;

  const thumb = exp.thumbnail
    ? `<img class="card-thumbnail" src="${exp.thumbnail}" alt="${exp.title}" />`
    : `<div class="card-thumbnail"></div>`;

  card.innerHTML = `
    ${thumb}
    <div class="card-body">
      <div class="card-title">${exp.title}</div>
      <div class="card-description">${exp.description}</div>
    </div>
    <div class="card-date">${date}</div>
  `;

  grid.appendChild(card);
}
