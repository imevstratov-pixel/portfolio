---
seo:
  title: 'Кейсы: консультации, AI-агенты и курсы — Даниил Евстратов'
  description: 'Кейсы из штата и заказы: модель компетенций, AI-агенты для разработки курсов, разбор и пересборка курсов, AI-боты и тренажёры. В каждом кейсе задача, что я сделал и результат.'
blocks:
- id: intro
  type: intro
  heading: Кейсы
  lead: Работа в штате и на заказ. В каждом кейсе задача, что я сделал, результат и что из этого сделаю для вас.
- id: toc
  type: cases-toc
  heading: Оглавление по услугам
  groups:
  - service: consulting
  - service: ai-agents
  - service: audit
  - service: course
  - service: app
    products:
    - barba
    - wishlist
  - service: game
    products:
    - skrizhal
    - top-pick
    - dobei
  - service: guide
  row:
    fields:
    - shortTitle
  productRow:
    labels:
    - Свой продукт
    - Разработка
    hrefPattern: /products/#{anchor}
  legend:
    origin: 'Происхождение: В штате, На заказ, Для близкого человека, Свой продукт.'
    direction: 'Направление: Обучение, Разработка, Обучение и разработка.'
- id: cases
  type: cases-list
  sort: order
  sections:
  - Контекст
  - Что сделал
  - Результат
  - Что из этого сделаю для вас
  labels:
  - origin
  - industry
  - year
  - duration
  - direction
  statusField: status
  serviceLinkLabel: Что из этого сделаю для вас
- id: contact
  type: contact
  anchor: contact
  heading: Обсудим, что я могу сделать для вашего курса или команды?
  hint: global.telegram.gridHint
  buttons:
  - Консультация
  - AI-агенты
  - Аудит
  - Курс
  - Приложение
  - Игра
  - Гайд
  - Другое
  email: global.email.line
  lines:
  - global.work.price
  - global.work.payment
  - global.work.languages
  workload: global.work.howWeStart.workload
---


