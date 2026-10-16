const GetMe = require("../controllers/auth/me.controller");
const CreateProject = require("../controllers/project/createProject.controller");
const DeleteProject = require("../controllers/project/deleteProject.controller");
const {GetProject, GetProjectById, GetProjectByUser} = require("../controllers/project/getProject.controller");
const PutProject = require("../controllers/project/putProject.controller");
const CreateTask = require("../controllers/task/createTask.controller");
const DeleteTask = require("../controllers/task/deleteTask.controller");
const {GetTask, GetTaskById, GetTaskByProjectId, GetTaskByUser} = require("../controllers/task/getTask.controller");
const PutTask = require("../controllers/task/putTask.controller");
const DeleteUser = require("../controllers/users/deleteUser.controller");
const {GetUser, GetUserById} = require("../controllers/users/getUser.controller");
const PutUser = require("../controllers/users/putUser.controller");
const {RequireAdmin, RequireOwnEmailOrAdmin} = require("../middlewares/authorize");

// opts.authenticate: the hook that signs the request in and sets req.user = {id, name, email, role, isAdmin},
// the one RegisterIam returns
const router = (router, opts, next) => {
  const authenticate = opts.authenticate;
  if (!authenticate) {
    throw new Error("The routes need opts.authenticate");
  }

  // Any signed-in user; the controller narrows the result to the caller's own data when the caller is not an admin
  const signedIn = {onRequest: [authenticate]};
  // Admin only (the screens and buttons the frontend shows to admins only)
  const adminOnly = {onRequest: [authenticate, RequireAdmin]};
  // A normal user only for their own email (taken from the URL or the body), an admin for anyone
  const ownEmailOrAdmin = (getEmail) => ({onRequest: [authenticate], preHandler: [RequireOwnEmailOrAdmin(getEmail)]});

  // Auth. Sign-in, callback, refresh and logout are the SDK routes under /api/auth (RegisterIam); accounts
  // are created and roles managed at VTK IAM
  router.get("/me", signedIn, GetMe);

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
