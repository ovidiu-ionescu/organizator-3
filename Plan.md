# Back end

## Database component
Only the logic that invokes the database procedures. The component only 
interacts with the database, does not care if the caller is a web app. Can be a
subcomponent of the bigger project.

## Web component
Deals with the web requests. Handles authentication and rejects unauthenticated
requests except the ones that are trying to authenticate.

Will use Hyper and Tower for that.

