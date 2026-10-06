const unescapeHtml = require("../../utils/unescapeHtml");

// Public in both modes: the frontend asks on load which sign-in to show
const GetAuthMode = (authMode) => async (req, res) => {
  return {mode: authMode};
};

// AUTH_MODE=iam: the signed-in user, for a frontend that holds no token it could decode.
// Name and email are stored escaped; they go out as the user typed them
const GetMe = async (req, res) => {
  return {
    id: req.user.id,
    name: unescapeHtml(req.user.name),
    email: unescapeHtml(req.user.email),
    role: req.user.role,
  };
};

// AUTH_MODE=iam: an endpoint of the old sign-in that no longer exists
const GoneInIamMode = (message) => async (req, res) => {
  res.status(410);
  return {code: 410, message};
};

module.exports = {GetAuthMode, GetMe, GoneInIamMode};
