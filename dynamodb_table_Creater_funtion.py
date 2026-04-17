import boto3 #library to talk to aws
import json ## most browsers accept response in json and event returned by aws serviees is in json format.


table_name= 'ImageRecognitionResults' # dynamodb table name is defined as ImageRecognitionResults
dynamodb_resource = boto3.resource('dynamodb',region_name='us-east-1') # calls dynamodb as resource insted of client so writing Syntax in the code gets easier.
def table_creator(): # defines the function table_creator
    try: # initializes the boto3 resource for dynamodb and creates a table with the specified name and schema.
        table = dynamodb_resource.create_table( # ceates a table with the following schema.
            TableName = table_name, #gets table name form the predeifined constant.
            KeySchema = [ # gives the table its composite key, its Partition key as image-id and it Sort Key as timestamp
                {"AttributeName": "image-id", "KeyType": "HASH"},
                {"AttributeName": "timestamp", "KeyType": "RANGE"}
            ],
            AttributeDefinitions = [ #tell dynamodb both image-id and timestamp has to be in String format.
                {"AttributeName": "Image_Id" , "AttributeType": "S" },
                {"AttributeName": "Timestamp" , "AttributeType": "S" }
            ],
            BillingMode = "PAY_PER_REQUEST" #tells dynamodb billing will be pay per request to the dyanamodb.
        )
        table.wait_until_exists() # waits till the table is created.
        return{ # returns the status code and message once the table is created.
            "statusCode" : 200,
            "body" : json.dumps(f"Table {table_name} is ready!")
        }
        
    except Exception as e: # if any unexpected error occurs it returns the error.
        return({
            "statusCode" : 500,
            "body" : str(f"Error: {e}")
        })