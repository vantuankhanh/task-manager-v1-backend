const unescapeHtml = require("../../utils/unescapeHtml");

// The signed-in user, for a frontend that holds no token it could decode.
// Name and email are stored escaped; they go out as the user typed them
const GetMe = async (req, res) => {
  return {
    id: req.user.id,
    name: unescapeHtml(req.user.name),
    email: unescapeHtml(req.user.email),
    role: req.user.role,
  };
};

module.exports = GetMe;
