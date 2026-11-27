Feature: A Taiga site on Docker Compose, Podman and Kubernetes
  The builder builds on DDEV by default, and with --runtime on Docker Compose, Podman or Kubernetes: Taiga's back-end
  image is the web container's, which runs its API, its Celery worker and the gateway as the host user, and its front
  end, its events, its protected media and the two RabbitMQ are services of the project. A site built there has the row
  a DDEV site has: its state, its own address, the runtime's menu, and the test users in its Tests menu.

  # Each scenario drives a real site of that runtime, built with cmd-taiga-project.sh --runtime: the first running one
  # the workspace holds that the plugin claims. Without one it is skipped, with the reason. In the plugin's CI the
  # Docker Compose site is the one the manifest's featuresSite builds.

  @needs-runtime-docker @needs-platform-taiga
  Scenario: A site built on Docker Compose runs at its own address, with the DOCKER menu
    Given I am on the folder of the "docker" site
     Then the row of the "docker" site should show "Running"
      And the row of the "docker" site should link to the address of its runtime
      And the address of the "docker" site should answer
      And the row of the "docker" site should carry the "DOCKER" menu and no DDEV menu

  @needs-runtime-docker @needs-platform-taiga
  Scenario: The Tests menu of a site on Docker Compose offers the test users
    Given I am on the folder of the "docker" site
     When I open the "tests" menu of the "docker" site
     Then the open menu should offer "Add the test users"
      And the open menu should offer "Cancel the test users"

  # A visitor gets Taiga's sign-in form, which its front end draws in the browser: the public sign-up is off.
  @needs-runtime-docker @needs-platform-taiga
  Scenario: The site on Docker Compose is set up: its sign-in form
    Given I am on the folder of the "docker" site
     When I open "/login" on the "docker" site
     Then eventually I should see "Login" within 60 seconds
      And I should see "Forgot it?"

  @needs-runtime-podman @needs-platform-taiga
  Scenario: A site built on Podman runs at its own address, with the PODMAN menu
    Given I am on the folder of the "podman" site
     Then the row of the "podman" site should show "Running"
      And the row of the "podman" site should link to the address of its runtime
      And the address of the "podman" site should answer
      And the row of the "podman" site should carry the "PODMAN" menu and no DDEV menu

  @needs-runtime-podman @needs-platform-taiga
  Scenario: The Tests menu of a site on Podman offers the test users
    Given I am on the folder of the "podman" site
     When I open the "tests" menu of the "podman" site
     Then the open menu should offer "Add the test users"
      And the open menu should offer "Cancel the test users"

  @needs-runtime-podman @needs-platform-taiga
  Scenario: The site on Podman is set up: its sign-in form
    Given I am on the folder of the "podman" site
     When I open "/login" on the "podman" site
     Then eventually I should see "Login" within 60 seconds
      And I should see "Forgot it?"

  @needs-runtime-kubernetes @needs-platform-taiga
  Scenario: A site built on Kubernetes runs at the address of its node, with the K8S menu
    Given I am on the folder of the "kubernetes" site
     Then the row of the "kubernetes" site should show "Running"
      And the row of the "kubernetes" site should link to the address of its runtime
      And the address of the "kubernetes" site should answer
      And the row of the "kubernetes" site should carry the "K8S" menu and no DDEV menu

  @needs-runtime-kubernetes @needs-platform-taiga
  Scenario: The Tests menu of a site on Kubernetes offers the test users
    Given I am on the folder of the "kubernetes" site
     When I open the "tests" menu of the "kubernetes" site
     Then the open menu should offer "Add the test users"
      And the open menu should offer "Cancel the test users"

  @needs-runtime-kubernetes @needs-platform-taiga
  Scenario: The site on Kubernetes is set up: its sign-in form
    Given I am on the folder of the "kubernetes" site
     When I open "/login" on the "kubernetes" site
     Then eventually I should see "Login" within 60 seconds
      And I should see "Forgot it?"
