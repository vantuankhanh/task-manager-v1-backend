const {Login, RefreshToken} = require("../controllers/auth/auth.controller");
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

// Any signed-in user; the controller narrows the result to the caller's own data when the caller is not an admin
const signedIn = {onRequest: [VerifyToken]};
// Admin only (the screens and buttons the frontend shows to admins only)
const adminOnly = {onRequest: [VerifyToken, RequireAdmin]};
// A normal user only for their own email (taken from the URL or the body), an admin for anyone
const ownEmailOrAdmin = (getEmail) => ({onRequest: [VerifyToken], preHandler: [RequireOwnEmailOrAdmin(getEmail)]});

const router = (router, opts, next) => {
  // Auth
  router.post("/login", Login);
  router.get("/refresh-token", RefreshToken);

  // User
  router.get("/user", signedIn, GetUser);
  router.get("/user/:id", signedIn, GetUserById);
  router.post("/user", CreateUser);
  router.delete("/user", adminOnly, DeleteUser);
  router.put(
    "/user",
    ownEmailOrAdmin((req) => req.body?.email),
    PutUser,
  );
  router.put("/user/changerole", adminOnly, ChangeRoleUser);

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
