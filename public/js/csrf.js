// Sends the session CSRF token with every browser side mutation.
(function () {
  var meta = document.querySelector('meta[name="csrf-token"]');
  var token = meta ? meta.getAttribute("content") : "";
  var FIELD = "_csrf";
  var HEADER = "X-CSRF-Token";

  window.csrfToken = function () {
    return token;
  };

  // For forms built in script, which never pass through the layout.
  window.csrfProtectForm = function (form) {
    if (!form || form.querySelector('input[name="' + FIELD + '"]')) {
      return form;
    }
    var input = document.createElement("input");
    input.type = "hidden";
    input.name = FIELD;
    input.value = token;
    form.appendChild(input);
    return form;
  };

  if (token && window.axios) {
    window.axios.defaults.headers.common[HEADER] = token;
  }
})();
