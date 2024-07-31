import {Login, RefreshToken} from "../controllers/auth/auth.controller.js";
import CreateProject from "../controllers/project/createProject.controller.js";
import DeleteProject from "../controllers/project/deleteProject.controller.js";
import {GetProject, GetProjectById, GetProjectByUser} from "../controllers/project/getProject.controller.js";
import PutProject from "../controllers/project/putProject.controller.js";
import CreateTask from "../controllers/task/createTask.controller.js";
import DeleteTask from "../controllers/task/deleteTask.controller.js";
import {GetTask, GetTaskById, GetTaskByProjectId, GetTaskByUser} from "../controllers/task/getTask.controller.js";
import PutTask from "../controllers/task/putTask.controller.js";
import ChangeRoleUser from "../controllers/users/changeRoleUser.controller.js";
import CreateUser from "../controllers/users/createUser.controller.js";
import DeleteUser from "../controllers/users/deleteUser.controller.js";
import {GetUser, GetUserById} from "../controllers/users/getUser.controller.js";
import PutUser from "../controllers/users/putUser.controller.js";
import VerifyToken from "../middlewares/verifyToken.js";

export const router = (router, opts, next) => {
  router.get("/", async (req, res) => {
    res.send({hello: "Home Page with Fastify"});
  });

  // Auth
  router.post("/login", Login);
  router.get("/refresh-token", RefreshToken);

  // User
  router.get("/user", {onRequest: [VerifyToken]}, GetUser);
  router.get("/user/:id", {onRequest: [VerifyToken]}, GetUserById);
  router.post("/user", CreateUser);
  router.delete("/user", {onRequest: [VerifyToken]}, DeleteUser);
  router.put("/user", {onRequest: [VerifyToken]}, PutUser);
  router.put("/user/changerole", {onRequest: [VerifyToken]}, ChangeRoleUser);

  // Project
  router.get("/project", {onRequest: [VerifyToken]}, GetProject);
  router.get("/project/:id", {onRequest: [VerifyToken]}, GetProjectById);
  router.post("/project", {onRequest: [VerifyToken]}, CreateProject);
  router.delete("/project", {onRequest: [VerifyToken]}, DeleteProject);
  router.put("/project", {onRequest: [VerifyToken]}, PutProject);

  // Task
  router.get("/task", {onRequest: [VerifyToken]}, GetTask);
  router.get("/task/:id", {onRequest: [VerifyToken]}, GetTaskById); //GetTaskDetail
  router.post("/task", {onRequest: [VerifyToken]}, CreateTask);
  router.delete("/task", {onRequest: [VerifyToken]}, DeleteTask);
  router.put("/task", {onRequest: [VerifyToken]}, PutTask);

  // GetTaskBy.......
  router.get("/gettaskbyprojectid/:id", {onRequest: [VerifyToken]}, GetTaskByProjectId); //GetTaskByProjectId
  router.get("/gettaskbyuser/:name", {onRequest: [VerifyToken]}, GetTaskByUser); //GetTaskByUser

  // GetProjectBy.......
  router.get("/getprojectbyuser/:email", {onRequest: [VerifyToken]}, GetProjectByUser); //GetProjectByUser

  next();
};
