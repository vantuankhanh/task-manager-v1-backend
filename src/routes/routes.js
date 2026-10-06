const {Login, RefreshToken} = require("../controllers/auth/auth.controller");
const {GetAuthMode, GetMe, GoneInIamMode} = require("../controllers/auth/authMode.controller");
const CreateProject = require("../controllers/project/createProject.controller");
const DeleteProject = require("../controllers/project/deleteProject.controller");
const {GetProject, GetProjectById, GetProjectByUser} = require("../controllers/project/getProject.controller");
const PutProject = require("../controllers/project/putProject.controller");
const CreateTask = require("../controllers/task/createTask.controller");
const DeleteTask = require("../controllers/task/deleteTask.controller");
const {GetTask, GetTaskById, GetTaskByProjectId, GetTaskByUser} = require("../controllers/task/getTask.controller");
const PutTask = require("../controllers/task/putTask.controller");
const ChangeRoleUser = require("../controllers/users/changeRoleUser.controller");
const CreateUser = require("../controllers/users/createUser.controller");
const DeleteUser = require("../controllers/users/deleteUser.controller");
const {GetUser, GetUserById} = require("../controllers/users/getUser.controller");
const PutUser = require("../controllers/users/putUser.controller");
const VerifyToken = require("../middlewares/verifyToken");
const {RequireAdmin, RequireOwnEmailOrAdmin} = require("../middlewares/authorize");
const {AUTH_MODE_LEGACY, AUTH_MODE_IAM} = require("../utils/authConfig");

// opts.authMode: "legacy" (default) or "iam", see utils/authConfig.js.
// opts.authenticate: the hook that signs the request in and sets req.user = {id, name, email, role}.
// VerifyToken in legacy mode (default), the hook returned by RegisterIam in iam mode.
// The rules below are the same in both modes
const router = (router, opts, next) => {
  const authMode = opts.authMode || AUTH_MODE_LEGACY;
  const authenticate = opts.authenticate || VerifyToken;

  // Any signed-in user; the controller narrows the result to the caller's own data when the caller is not an admin
  const signedIn = {onRequest: [authenticate]};
  // Admin only (the screens and buttons the frontend shows to admins only)
  const adminOnly = {onRequest: [authenticate, RequireAdmin]};
  // A normal user only for their own email (taken from the URL or the body), an admin for anyone
  const ownEmailOrAdmin = (getEmail) => ({onRequest: [authenticate], preHandler: [RequireOwnEmailOrAdmin(getEmail)]});

  // Auth
  router.get("/auth/config", GetAuthMode(authMode));
  if (authMode === AUTH_MODE_IAM) {
    // Sign-in, callback, refresh and logout are the SDK routes under /api/auth (RegisterIam)
    router.get("/me", signedIn, GetMe);
    router.post("/login", GoneInIamMode("Sign in through VTK IAM: GET /api/auth/login"));
    router.get("/refresh-token", GoneInIamMode("Refresh through VTK IAM: POST /api/auth/refresh"));
    router.post("/user", GoneInIamMode("Accounts are created at VTK IAM"));
    router.put("/user/changerole", GoneInIamMode("Roles are managed in the VTK IAM console"));
  } else {
    router.post("/login", Login);
    router.get("/refresh-token", RefreshToken);
    router.post("/user", CreateUser);
    router.put("/user/changerole", adminOnly, ChangeRoleUser);
  }

  // User
  router.get("/user", signedIn, GetUser);
  router.get("/user/:id", signedIn, GetUserById);
  router.delete("/user", adminOnly, DeleteUser);
  router.put(
    "/user",
    ownEmailOrAdmin((req) => req.body?.email),
    PutUser,
  );

  // Project
  router.get("/project", signedIn, GetProject);
  router.get("/project/:id", signedIn, GetProjectById);
  router.post("/project", adminOnly, CreateProject);
  router.delete("/project", adminOnly, DeleteProject);
  router.put("/project", adminOnly, PutProject);

  // Task
  router.get("/task", adminOnly, GetTask);
  router.get("/task/:id", signedIn, GetTaskById); //GetTaskDetail
  router.post("/task", adminOnly, CreateTask);
  router.delete("/task", adminOnly, DeleteTask);
  router.put("/task", signedIn, PutTask);

  // GetTaskBy.......
  router.get("/gettaskbyprojectid/:id", adminOnly, GetTaskByProjectId); //GetTaskByProjectId
  router.get(
    "/gettaskbyuser/:name",
    ownEmailOrAdmin((req) => req.params.name),
    GetTaskByUser,
  ); //GetTaskByUser

  // GetProjectBy.......
  router.get(
    "/getprojectbyuser/:email",
    ownEmailOrAdmin((req) => req.params.email),
    GetProjectByUser,
  ); //GetProjectByUser

  next();
};

module.exports = router;
