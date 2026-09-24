H5P.AnswerList = H5P.AnswerList || {};

/**
 * Matches learner entries against groups of acceptable answers.
 */
H5P.AnswerList.Matcher = (function () {
  'use strict';

  /**
   * @class
   * @param {string[][]} groups Acceptable answers, each group holding its alternatives
   * @param {object} options
   * @param {boolean} options.caseSensitive
   * @param {boolean} options.acceptSpellingErrors
   * @param {boolean} options.ignoreArticles
   * @param {string} options.articles Comma separated list of articles to ignore
   */
  function Matcher(groups, options) {
    this.options = options || {};
    this.articles = (this.options.articles || '')
      .split(',')
      .map(function (article) {
        return article.trim().toLowerCase();
      })
      .filter(Boolean);

    // Pre-normalise every alternative once
    this.groups = groups.map(function (alternatives) {
      return alternatives.map(this.normalize, this);
    }, this);
  }

  /**
   * Split an author supplied answer string into its alternatives.
   *
   * @param {string|object} answer E.g. "bike | bicycle"
   * @return {string[]}
   */
  Matcher.parseAlternatives = function (answer) {
    if (answer && typeof answer === 'object') {
      answer = answer.answer;
    }
    return Matcher.decodeHtml(typeof answer === 'string' ? answer : '')
      .split('|')
      .map(function (alternative) {
        return alternative.trim();
      })
      .filter(Boolean);
  };

  /**
   * Plain text fields from the editor arrive HTML encoded.
   *
   * @param {string} text
   * @return {string}
   */
  Matcher.decodeHtml = function (text) {
    const element = document.createElement('textarea');
    element.innerHTML = text;
    return element.value;
  };

  /**
   * Normalise a string for comparison.
   *
   * @param {string} text
   * @return {string}
   */
  Matcher.prototype.normalize = function (text) {
    let value = (text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.,;:!?"'()\[\]។៕]+|[.,;:!?"'()\[\]។៕]+$/g, '')
      .trim();

    if (!this.options.caseSensitive) {
      value = value.toLowerCase();
    }

    if (this.options.ignoreArticles && this.articles.length) {
      const words = value.split(' ');
      if (words.length > 1 && this.articles.indexOf(words[0].toLowerCase()) !== -1) {
        value = words.slice(1).join(' ');
      }
    }

    return value;
  };

  /**
   * Check whether two raw entries are the same answer after normalisation.
   *
   * @param {string} a
   * @param {string} b
   * @return {boolean}
   */
  Matcher.prototype.isSame = function (a, b) {
    return this.normalize(a) === this.normalize(b);
  };

  /**
   * Evaluate a list of entries. Each answer group can be matched only once.
   * Exact matches are resolved before fuzzy ones so a typo can't take a group
   * that a later, correctly spelled entry needs.
   *
   * @param {string[]} entries
   * @return {{correct: boolean, groupIndex: number}[]}
   */
  Matcher.prototype.evaluate = function (entries) {
    const self = this;
    const used = {};
    const normalized = entries.map(self.normalize, self);
    const results = entries.map(function () {
      return { correct: false, groupIndex: -1 };
    });

    const assign = function (compare) {
      normalized.forEach(function (entry, i) {
        if (results[i].correct || entry === '') {
          return;
        }
        for (let g = 0; g < self.groups.length; g++) {
          if (!used[g] && self.groups[g].some(function (alt) {
            return compare(entry, alt);
          })) {
            used[g] = true;
            results[i] = { correct: true, groupIndex: g };
            return;
          }
        }
      });
    };

    assign(function (entry, alt) {
      return entry === alt;
    });

    if (self.options.acceptSpellingErrors && H5P.TextUtilities) {
      assign(function (entry, alt) {
        return H5P.TextUtilities.areSimilar(entry, alt);
      });
    }

    return results;
  };

  return Matcher;
})();
