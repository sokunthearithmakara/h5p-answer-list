H5P.AnswerList = (function ($, Question, Matcher) {
  'use strict';

  const XAPI_ALTERNATIVE_EXTENSION = 'https://h5p.org/x-api/alternatives';
  const XAPI_CASE_SENSITIVITY = 'https://h5p.org/x-api/case-sensitivity';
  const XAPI_ITEMS_EXTENSION = 'https://h5p.org/x-api/answer-list/items';

  const STATE_ONGOING = 'ongoing';
  const STATE_CHECKED = 'checked';
  const STATE_SOLUTION = 'solution';

  let idCounter = 0;

  /**
   * @class
   * @param {object} params Content parameters
   * @param {number} contentId
   * @param {object} [contentData]
   */
  function AnswerList(params, contentId, contentData) {
    // H5P core 1.28+ ships the theme variables the themed buttons need.
    // On older cores (e.g. Lumi) fall back to the classic H5P.Question look.
    this.useTheme = AnswerList.isThemeAvailable();
    Question.call(this, 'answer-list', { theme: this.useTheme });

    // Show the task description above the media
    this.order = ['introduction'].concat(this.order.filter(function (section) {
      return section !== 'introduction';
    }));

    this.contentId = contentId;
    this.contentData = contentData || {};
    this.params = $.extend(true, {
      media: {},
      taskDescription: '',
      text: '',
      answers: '',
      penalty: 0,
      overallFeedback: [],
      matching: {
        caseSensitive: false,
        acceptSpellingErrors: false,
        ignoreArticles: false
      },
      behaviour: {
        instantFeedback: false,
        enableSolutionsButton: true,
        enableRetry: true,
        enableRetryIncorrect: true,
        requireFullList: false,
        preventTextSelection: false,
        preventPaste: false
      },
      l10n: {
        checkAnswer: 'Check',
        showSolution: 'Show solution',
        tryAgain: 'Retry',
        retryIncorrect: 'Retry incorrect',
        addItem: 'Add to list',
        inputLabel: 'Your answer',
        placeholder: 'Type an answer and press Enter',
        itemCount: '@count / @max items',
        removeItem: 'Remove @item',
        emptyError: 'Enter an answer first.',
        duplicateError: 'That answer is already in your list.',
        fullError: 'Your list is full. Remove an item to add another.',
        pasteDisabled: 'Pasting is turned off. Type your answer instead.',
        noItemsError: 'Add at least one item before checking.',
        notFullError: 'Add @max items before checking.',
        solutionHeading: 'Other acceptable answers',
        resultSummary: '@correct correct, @incorrect incorrect',
        penaltySummary: '(@points points deducted)',
        articles: 'a, an, the',
        scoreBarLabel: 'You got :num out of :total points'
      },
      a11y: {
        itemAdded: 'Added @item. @count of @max items.',
        itemRemoved: 'Removed @item.',
        correct: 'Correct',
        incorrect: 'Incorrect',
        solution: 'Solution',
        yourList: 'Your answers',
        check: 'Check the answers. The responses will be marked as correct or incorrect.',
        showSolution: 'Show the solution. The task will be marked with its correct solution.',
        retry: 'Retry the task. All answers are removed.',
        retryIncorrect: 'Retry the incorrect answers. Incorrect answers are removed; correct answers are kept.'
      }
    }, params);

    // Answer groups, each holding its alternatives. One answer per line;
    // older content stored a list of answers.
    const answers = Array.isArray(this.params.answers)
      ? this.params.answers
      : String(this.params.answers || '').split(/\r?\n/);
    this.groups = answers
      .map(Matcher.parseAlternatives)
      .filter(function (alternatives) {
        return alternatives.length > 0;
      });

    const groupCount = Math.max(this.groups.length, 1);
    this.maxItems = Math.max(1, parseInt(this.params.maxItems, 10) || groupCount);
    this.requiredCorrect = Math.min(
      Math.max(1, parseInt(this.params.requiredCorrect, 10) || this.maxItems),
      this.maxItems,
      groupCount
    );
    this.penalty = Math.max(0, parseFloat(this.params.penalty) || 0);

    this.matcher = new Matcher(this.groups, {
      caseSensitive: this.params.matching.caseSensitive,
      acceptSpellingErrors: this.params.matching.acceptSpellingErrors,
      ignoreArticles: this.params.matching.ignoreArticles,
      articles: this.params.l10n.articles
    });

    /** @type {{text: string, correct: boolean, groupIndex: number}[]} */
    this.items = [];
    this.state = STATE_ONGOING;
    this.id = 'h5p-answer-list-' + (idCounter++);

    const previousState = this.contentData.previousState;
    if (previousState && Array.isArray(previousState.items)) {
      this.items = previousState.items.slice(0, this.maxItems).map(function (text) {
        return { text: String(text), correct: false, groupIndex: -1 };
      });
      this.restoreChecked = !!previousState.checked;
    }
  }

  AnswerList.prototype = Object.create(Question.prototype);
  AnswerList.prototype.constructor = AnswerList;

  /**
   * Whether the H5P core provides the theme (core 1.28+).
   *
   * @return {boolean}
   */
  AnswerList.isThemeAvailable = function () {
    try {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--h5p-theme-main-cta-base').trim() !== '';
    }
    catch (e) {
      return false;
    }
  };

  /**
   * Register DOM elements with H5P.Question.
   */
  AnswerList.prototype.registerDomElements = function () {
    const self = this;

    self.registerMedia();

    const intro = document.createElement('div');
    intro.id = self.id + '-task';
    intro.innerHTML = self.params.taskDescription;
    self.setIntroduction(intro);

    self.setContent(self.createContent());

    if (self.params.behaviour.preventTextSelection) {
      self.preventCopying(intro);
      if (self.textElement) {
        self.preventCopying(self.textElement);
      }
    }

    self.addButton('check-answer', self.params.l10n.checkAnswer, function () {
      self.checkAnswer();
    }, true, { 'aria-label': self.params.a11y.check }, {
      contentData: self.contentData,
      icon: 'check'
    });

    self.addButton('show-solution', self.params.l10n.showSolution, function () {
      self.showSolutions();
    }, false, { 'aria-label': self.params.a11y.showSolution }, {
      styleType: 'secondary',
      icon: 'show-results'
    });

    self.addButton('try-again', self.params.l10n.tryAgain, function () {
      self.retry();
    }, false, { 'aria-label': self.params.a11y.retry }, {
      styleType: 'secondary',
      icon: 'go-to-start'
    });

    self.addButton('try-again-incorrect', self.params.l10n.retryIncorrect, function () {
      self.retryIncorrect();
    }, false, { 'aria-label': self.params.a11y.retryIncorrect }, {
      styleType: 'secondary',
      icon: 'retry'
    });

    if (self.items.length && (self.params.behaviour.instantFeedback || self.restoreChecked)) {
      self.evaluate();
    }
    self.renderList();

    if (self.restoreChecked && self.items.length) {
      self.finishCheck(false);
    }
  };

  /**
   * Register optional task media (same approach as Fill in the Blanks).
   */
  AnswerList.prototype.registerMedia = function () {
    const media = this.params.media;
    if (!media || !media.type || !media.type.library) {
      return;
    }
    const type = media.type.library.split(' ')[0];
    const mediaParams = media.type.params || {};

    if (type === 'H5P.Image' && mediaParams.file) {
      this.setImage(mediaParams.file.path, {
        disableImageZooming: media.disableImageZooming || false,
        alt: mediaParams.alt,
        title: mediaParams.title,
        expandImage: mediaParams.expandImage,
        minimizeImage: mediaParams.minimizeImage
      });
    }
    else if (type === 'H5P.Video' && mediaParams.sources) {
      this.setVideo(media.type);
    }
    else if (type === 'H5P.Audio' && mediaParams.files) {
      this.setAudio(media.type);
    }
  };

  /**
   * Build the task content: supporting text, input row, list and solutions.
   *
   * @return {HTMLElement}
   */
  AnswerList.prototype.createContent = function () {
    const self = this;
    const l10n = self.params.l10n;

    const wrapper = document.createElement('div');
    wrapper.className = 'h5p-answer-list-content';

    if (self.params.text) {
      self.textElement = document.createElement('div');
      self.textElement.className = 'h5p-answer-list-text';
      self.textElement.innerHTML = self.params.text;
      wrapper.appendChild(self.textElement);
    }

    // Input row
    const inputRow = document.createElement('div');
    inputRow.className = 'h5p-answer-list-input-row';

    self.input = document.createElement('input');
    self.input.type = 'text';
    self.input.className = 'h5p-answer-list-input';
    self.input.id = self.id + '-input';
    self.input.placeholder = l10n.placeholder;
    self.input.setAttribute('aria-label', l10n.inputLabel);
    self.input.setAttribute('aria-describedby', self.id + '-task ' + self.id + '-error ' + self.id + '-count');
    self.input.setAttribute('autocomplete', 'off');
    self.input.setAttribute('spellcheck', 'false');
    self.input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        self.addItem(self.input.value);
      }
    });
    self.input.addEventListener('input', function () {
      self.setError('');
    });
    if (self.params.behaviour.preventPaste) {
      self.preventPasting(self.input);
    }
    inputRow.appendChild(self.input);

    self.addButtonElement = document.createElement('button');
    self.addButtonElement.type = 'button';
    self.addButtonElement.className = 'h5p-answer-list-add';
    self.addButtonElement.setAttribute('aria-label', l10n.addItem);
    self.addButtonElement.title = l10n.addItem;
    self.addButtonElement.addEventListener('click', function () {
      self.addItem(self.input.value);
      self.input.focus();
    });
    inputRow.appendChild(self.addButtonElement);
    wrapper.appendChild(inputRow);

    self.errorElement = document.createElement('div');
    self.errorElement.className = 'h5p-answer-list-error';
    self.errorElement.id = self.id + '-error';
    self.errorElement.setAttribute('aria-live', 'assertive');
    wrapper.appendChild(self.errorElement);

    self.countElement = document.createElement('div');
    self.countElement.className = 'h5p-answer-list-count';
    self.countElement.id = self.id + '-count';
    wrapper.appendChild(self.countElement);

    self.listElement = document.createElement('ol');
    self.listElement.className = 'h5p-answer-list-items';
    self.listElement.setAttribute('aria-label', self.params.a11y.yourList);
    wrapper.appendChild(self.listElement);

    self.summaryElement = document.createElement('div');
    self.summaryElement.className = 'h5p-answer-list-summary';
    wrapper.appendChild(self.summaryElement);

    self.solutionElement = document.createElement('div');
    self.solutionElement.className = 'h5p-answer-list-solutions';
    wrapper.appendChild(self.solutionElement);

    return wrapper;
  };

  /**
   * Stop learners from selecting or copying text in an element.
   * This is a deterrent only; it can't stop a determined learner.
   *
   * @param {HTMLElement} element
   */
  AnswerList.prototype.preventCopying = function (element) {
    element.classList.add('h5p-answer-list-no-select');
    ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'].forEach(function (type) {
      element.addEventListener(type, function (event) {
        event.preventDefault();
      });
    });
  };

  /**
   * Block paste (keyboard shortcut, context menu, drag and drop) in a field.
   *
   * @param {HTMLInputElement} input
   */
  AnswerList.prototype.preventPasting = function (input) {
    const self = this;
    const block = function (event) {
      event.preventDefault();
      self.setError(self.params.l10n.pasteDisabled);
    };
    input.addEventListener('paste', block);
    input.addEventListener('drop', block);
    input.addEventListener('contextmenu', function (event) {
      event.preventDefault();
    });
    // Mobile keyboards can insert clipboard text without a paste event
    input.addEventListener('beforeinput', function (event) {
      if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') {
        block(event);
      }
    });
  };

  /**
   * Show or clear the inline error message.
   *
   * @param {string} message
   */
  AnswerList.prototype.setError = function (message) {
    this.errorElement.textContent = message;
  };

  /**
   * @param {string} template
   * @param {object} values
   * @return {string}
   */
  const fill = function (template, values) {
    return Object.keys(values).reduce(function (text, key) {
      return text.split('@' + key).join(values[key]);
    }, template);
  };

  /**
   * Add an entry to the list.
   *
   * @param {string} value
   */
  AnswerList.prototype.addItem = function (value) {
    const self = this;
    const l10n = self.params.l10n;
    const text = (value || '').replace(/\s+/g, ' ').trim();

    if (self.state !== STATE_ONGOING) {
      return;
    }
    if (!text) {
      self.setError(l10n.emptyError);
      return;
    }
    if (self.items.some(function (item) {
      return self.matcher.isSame(item.text, text);
    })) {
      self.setError(l10n.duplicateError);
      return;
    }
    if (self.items.length >= self.maxItems) {
      self.setError(l10n.fullError);
      return;
    }

    self.items.push({ text: text, correct: false, groupIndex: -1 });
    self.input.value = '';
    self.setError('');

    if (self.params.behaviour.instantFeedback) {
      self.evaluate();
    }
    self.renderList();

    const added = self.items[self.items.length - 1];
    let announcement = fill(self.params.a11y.itemAdded, {
      item: text,
      count: self.items.length,
      max: self.maxItems
    });
    if (self.params.behaviour.instantFeedback) {
      announcement += ' ' + (added.correct ? self.params.a11y.correct : self.params.a11y.incorrect) + '.';
    }
    self.read(announcement);

    self.triggerXAPI('interacted');
  };

  /**
   * Remove an entry from the list.
   *
   * @param {number} index
   */
  AnswerList.prototype.removeItem = function (index) {
    const removed = this.items.splice(index, 1)[0];
    if (!removed) {
      return;
    }
    this.setError('');

    if (this.params.behaviour.instantFeedback) {
      this.evaluate();
    }
    this.renderList();

    // Keep keyboard focus in a sensible place
    const buttons = this.listElement.querySelectorAll('.h5p-answer-list-remove');
    if (buttons.length) {
      buttons[Math.min(index, buttons.length - 1)].focus();
    }
    else {
      this.input.focus();
    }

    this.read(fill(this.params.a11y.itemRemoved, { item: removed.text }));
    this.triggerXAPI('interacted');
  };

  /**
   * Mark every item as correct or incorrect.
   */
  AnswerList.prototype.evaluate = function () {
    const results = this.matcher.evaluate(this.items.map(function (item) {
      return item.text;
    }));
    this.items.forEach(function (item, i) {
      item.correct = results[i].correct;
      item.groupIndex = results[i].groupIndex;
    });
  };

  /**
   * Render the learner's list and the item counter.
   */
  AnswerList.prototype.renderList = function () {
    const self = this;
    const a11y = self.params.a11y;
    const showState = self.state !== STATE_ONGOING || self.params.behaviour.instantFeedback;
    const canRemove = self.state === STATE_ONGOING;

    self.listElement.innerHTML = '';
    self.items.forEach(function (item, index) {
      const li = document.createElement('li');
      li.className = 'h5p-answer-list-item';
      if (showState) {
        li.classList.add(item.correct ? 'h5p-correct' : 'h5p-wrong');
      }

      const icon = document.createElement('span');
      icon.className = 'h5p-answer-list-icon';
      icon.setAttribute('aria-hidden', 'true');
      li.appendChild(icon);

      const text = document.createElement('span');
      text.className = 'h5p-answer-list-item-text';
      text.textContent = item.text;
      li.appendChild(text);

      if (showState) {
        const status = document.createElement('span');
        status.className = 'h5p-answer-list-sr-only';
        status.textContent = ', ' + (item.correct ? a11y.correct : a11y.incorrect);
        li.appendChild(status);
      }

      if (canRemove) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'h5p-answer-list-remove';
        const label = fill(self.params.l10n.removeItem, { item: item.text });
        remove.setAttribute('aria-label', label);
        remove.title = label;
        remove.addEventListener('click', function () {
          self.removeItem(index);
        });
        li.appendChild(remove);
      }

      self.listElement.appendChild(li);
    });

    self.countElement.textContent = fill(self.params.l10n.itemCount, {
      count: self.items.length,
      max: self.maxItems
    });

    const inputDisabled = self.state !== STATE_ONGOING || self.items.length >= self.maxItems;
    self.input.disabled = inputDisabled;
    self.addButtonElement.disabled = inputDisabled;

    // A full list is not an error: explain the disabled field in its placeholder
    const full = self.state === STATE_ONGOING && self.items.length >= self.maxItems;
    self.input.placeholder = full ? self.params.l10n.fullError : self.params.l10n.placeholder;

    self.trigger('resize');
  };

  /**
   * Handle the Check button.
   */
  AnswerList.prototype.checkAnswer = function () {
    const l10n = this.params.l10n;

    if (!this.items.length) {
      this.setError(l10n.noItemsError);
      this.input.focus();
      return;
    }
    if (this.params.behaviour.requireFullList && this.items.length < this.maxItems) {
      this.setError(fill(l10n.notFullError, { max: this.maxItems }));
      this.input.focus();
      return;
    }

    this.evaluate();
    this.finishCheck(true);
  };

  /**
   * Lock the list, show feedback and optionally send the answered statement.
   *
   * @param {boolean} triggerAnswered
   */
  AnswerList.prototype.finishCheck = function (triggerAnswered) {
    this.state = STATE_CHECKED;
    this.setError('');
    this.renderList();
    this.showEvaluation();
    this.updateButtons();
    this.trigger('resize');

    if (triggerAnswered) {
      const correct = this.getCorrectCount();
      this.read(fill(this.params.l10n.resultSummary, {
        correct: correct,
        incorrect: this.items.length - correct
      }));
      this.triggerAnswered();
    }
  };

  /**
   * Show the score bar and overall feedback.
   */
  AnswerList.prototype.showEvaluation = function () {
    const l10n = this.params.l10n;
    const score = this.getScore();
    const maxScore = this.getMaxScore();
    const correct = this.getCorrectCount();
    const incorrect = this.items.length - correct;

    let summary = fill(l10n.resultSummary, { correct: correct, incorrect: incorrect });
    const deducted = this.getDeduction();
    if (deducted > 0) {
      summary += ' ' + fill(l10n.penaltySummary, { points: deducted });
    }
    this.summaryElement.textContent = summary;

    const feedback = Question.determineOverallFeedback(this.params.overallFeedback, score / maxScore)
      .replace('@score', score)
      .replace('@total', maxScore);

    this.setFeedback(feedback, score, maxScore, l10n.scoreBarLabel);
  };

  /**
   * Show or hide the Check / Show solution / Retry buttons.
   */
  AnswerList.prototype.updateButtons = function () {
    const behaviour = this.params.behaviour;
    const perfect = this.getScore() === this.getMaxScore() && this.getCorrectCount() === this.items.length;

    if (this.state === STATE_ONGOING) {
      this.showButton('check-answer');
      this.hideButton('show-solution');
      this.hideButton('try-again');
      this.hideButton('try-again-incorrect');
      return;
    }

    this.hideButton('check-answer');

    if (this.state === STATE_CHECKED && behaviour.enableSolutionsButton && !perfect && this.getUnmatchedGroups().length) {
      this.showButton('show-solution');
    }
    else {
      this.hideButton('show-solution');
    }

    if (behaviour.enableRetry && !perfect) {
      this.showButton('try-again');
    }
    else {
      this.hideButton('try-again');
    }

    if (behaviour.enableRetryIncorrect && !perfect) {
      this.showButton('try-again-incorrect');
    }
    else {
      this.hideButton('try-again-incorrect');
    }
  };

  /**
   * Retry: remove every item and start over.
   */
  AnswerList.prototype.retry = function () {
    this.items = [];
    this.resetToOngoing();
    this.input.focus();
  };

  /**
   * Retry incorrect: keep correct items, remove incorrect ones.
   */
  AnswerList.prototype.retryIncorrect = function () {
    this.items = this.items.filter(function (item) {
      return item.correct;
    });
    this.resetToOngoing();
    this.input.focus();
  };

  /**
   * Return to the editable state without touching the items.
   */
  AnswerList.prototype.resetToOngoing = function () {
    this.state = STATE_ONGOING;
    this.removeFeedback();
    this.summaryElement.textContent = '';
    this.solutionElement.innerHTML = '';
    this.setError('');
    if (this.params.behaviour.instantFeedback) {
      this.evaluate();
    }
    this.renderList();
    this.updateButtons();
    this.trigger('resize');
  };

  /**
   * @return {string[][]} Answer groups the learner didn't match
   */
  AnswerList.prototype.getUnmatchedGroups = function () {
    const used = {};
    this.items.forEach(function (item) {
      if (item.correct) {
        used[item.groupIndex] = true;
      }
    });
    return this.groups.filter(function (group, index) {
      return !used[index];
    });
  };

  /**
   * @return {number}
   */
  AnswerList.prototype.getCorrectCount = function () {
    return this.items.filter(function (item) {
      return item.correct;
    }).length;
  };

  /**
   * @return {number} Points deducted for incorrect items (before clamping)
   */
  AnswerList.prototype.getDeduction = function () {
    const incorrect = this.items.length - this.getCorrectCount();
    return Math.round(incorrect * this.penalty * 100) / 100;
  };

  // ---------------------------------------------------------------------------
  // Question type contract
  // ---------------------------------------------------------------------------

  AnswerList.prototype.getAnswerGiven = function () {
    return this.items.length > 0;
  };

  AnswerList.prototype.getScore = function () {
    this.evaluate();
    const raw = Math.min(this.getCorrectCount(), this.requiredCorrect) - this.getDeduction();
    return Math.max(0, Math.round(raw * 100) / 100);
  };

  AnswerList.prototype.getMaxScore = function () {
    return this.requiredCorrect;
  };

  AnswerList.prototype.showSolutions = function () {
    const self = this;
    const a11y = self.params.a11y;

    self.evaluate();
    if (self.state === STATE_ONGOING) {
      self.state = STATE_CHECKED;
      self.showEvaluation();
    }
    self.state = STATE_SOLUTION;
    self.renderList();

    self.solutionElement.innerHTML = '';
    const unmatched = self.getUnmatchedGroups();
    if (unmatched.length) {
      const heading = document.createElement('div');
      heading.className = 'h5p-answer-list-solution-heading';
      heading.id = self.id + '-solution-heading';
      heading.textContent = self.params.l10n.solutionHeading;
      self.solutionElement.appendChild(heading);

      const list = document.createElement('ul');
      list.className = 'h5p-answer-list-items h5p-answer-list-solution-items';
      list.setAttribute('aria-labelledby', heading.id);
      unmatched.forEach(function (group) {
        const li = document.createElement('li');
        li.className = 'h5p-answer-list-item h5p-solution';

        const icon = document.createElement('span');
        icon.className = 'h5p-answer-list-icon';
        icon.setAttribute('aria-hidden', 'true');
        li.appendChild(icon);

        const status = document.createElement('span');
        status.className = 'h5p-answer-list-sr-only';
        status.textContent = a11y.solution + ': ';
        li.appendChild(status);

        const text = document.createElement('span');
        text.className = 'h5p-answer-list-item-text';
        text.textContent = group.join(' / ');
        li.appendChild(text);

        list.appendChild(li);
      });
      self.solutionElement.appendChild(list);
    }

    self.updateButtons();
    self.trigger('resize');
  };

  AnswerList.prototype.resetTask = function () {
    this.items = [];
    this.restoreChecked = false;
    this.input.value = '';
    this.resetToOngoing();
  };

  AnswerList.prototype.getCurrentState = function () {
    if (!this.items.length) {
      return;
    }
    return {
      items: this.items.map(function (item) {
        return item.text;
      }),
      checked: this.state !== STATE_ONGOING
    };
  };

  AnswerList.prototype.getTitle = function () {
    return H5P.createTitle((this.contentData.metadata && this.contentData.metadata.title) || 'Answer List');
  };

  // ---------------------------------------------------------------------------
  // xAPI
  // ---------------------------------------------------------------------------

  AnswerList.prototype.triggerAnswered = function () {
    const xAPIEvent = this.createXAPIEventTemplate('answered');
    this.addQuestionToXAPI(xAPIEvent);
    this.addResponseToXAPI(xAPIEvent);
    this.trigger(xAPIEvent);
  };

  AnswerList.prototype.getXAPIData = function () {
    const xAPIEvent = this.createXAPIEventTemplate('answered');
    this.addQuestionToXAPI(xAPIEvent);
    this.addResponseToXAPI(xAPIEvent);
    return {
      statement: xAPIEvent.data.statement
    };
  };

  /**
   * @return {object} xAPI activity definition
   */
  AnswerList.prototype.getxAPIDefinition = function () {
    const caseSensitive = !!this.params.matching.caseSensitive;
    const description = this.params.taskDescription + (this.params.text || '');

    const definition = {
      description: { 'en-US': description },
      type: 'http://adlnet.gov/expapi/activities/cmi.interaction',
      interactionType: 'fill-in',
      correctResponsesPattern: [
        '{case_matters=' + caseSensitive + '}{order_matters=false}' +
        this.groups.map(function (group) {
          return group[0];
        }).join('[,]')
      ],
      extensions: {}
    };
    definition.extensions[XAPI_CASE_SENSITIVITY] = caseSensitive;
    definition.extensions[XAPI_ALTERNATIVE_EXTENSION] = this.groups;

    return definition;
  };

  AnswerList.prototype.addQuestionToXAPI = function (xAPIEvent) {
    const definition = xAPIEvent.getVerifiedStatementValue(['object', 'definition']);
    $.extend(true, definition, this.getxAPIDefinition());
  };

  AnswerList.prototype.addResponseToXAPI = function (xAPIEvent) {
    xAPIEvent.setScoredResult(this.getScore(), this.getMaxScore(), this, true,
      this.getScore() >= this.getMaxScore());

    const result = xAPIEvent.data.statement.result;
    result.response = this.items.map(function (item) {
      return item.text;
    }).join('[,]');
    result.extensions = result.extensions || {};
    result.extensions[XAPI_ITEMS_EXTENSION] = this.items.map(function (item) {
      return { text: item.text, correct: item.correct };
    });
  };

  return AnswerList;
})(H5P.jQuery, H5P.Question, H5P.AnswerList.Matcher);
